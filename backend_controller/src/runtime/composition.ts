/**
 * Backend composition root. Parses the environment, constructs the shared
 * singletons (pool, database, unit of work, crypto, access-token service,
 * repositories, and the SNS certificate fetcher), and returns a `registerRoutes`
 * function that wires every canonical first-slice route onto a Fastify instance,
 * plus a readiness check and a `dispose` that closes the pool.
 *
 * The email delivery *worker* (which needs a concrete Amazon SES sender) runs as
 * a separate background entrypoint and is intentionally not part of the HTTP
 * server composition.
 */
import type { FastifyInstance } from "fastify"

import { createAccessTokenService } from "../auth/accessToken.js"
import { createBreachChecker, resolveBreachCheckMode } from "../auth/breachCheck.js"
import { configurePasswordWorkGate } from "../auth/passwordGate.js"
import { createCryptoContext, parseCryptoKeys } from "../crypto/context.js"
import {
  dispatchDueDeliveries,
  type DispatchSummary,
} from "../domain/email/dispatchDueDeliveries.js"
import { createTransactionalEmailSender } from "../email/transactionalEmailSender.js"
import { createDatabase, createUnitOfWork } from "../db/database.js"
import { parseDatabaseConfig } from "../db/config.js"
import { createPool } from "../db/pool.js"
import { createCertificateFetcher } from "../email/certificateFetcher.js"
import { createApplicationRepository } from "../repositories/applicationRepository.js"
import { createClientCatalogRepository } from "../repositories/clientCatalogRepository.js"
import { createClientPortfolioRepository } from "../repositories/clientPortfolioRepository.js"
import { createInvestorLedgerRepository } from "../repositories/investorLedgerRepository.js"
import { createRedemptionRepository } from "../repositories/redemptionRepository.js"
import { createKycRepository } from "../repositories/kycRepository.js"
import {
  createSmtpEmailSender,
  createUnconfiguredEmailSender,
  type EmailSender,
} from "../email/emailSender.js"
import { createMandateRepository } from "../repositories/mandateRepository.js"
import { createNotificationRepository } from "../repositories/notificationRepository.js"
import { createOrderRepository } from "../repositories/orderRepository.js"
import { createPaymentRepository } from "../repositories/paymentRepository.js"
import { createSipRepository } from "../repositories/sipRepository.js"
import { settleDuePayments, type SettleSummary } from "../domain/client/settlePayment.js"
import { generateSipInstallments, type GenerateSipInstallmentsSummary } from "../domain/client/generateSipInstallments.js"
import { createApplicationReviewRepository } from "../repositories/applicationReviewRepository.js"
import { createAuditRepository } from "../repositories/auditRepository.js"
import { createAuthSessionRepository } from "../repositories/authSessionRepository.js"
import { createConsentRepository } from "../repositories/consentRepository.js"
import { createCredentialRepository } from "../repositories/credentialRepository.js"
import { createClientAccountRepository } from "../repositories/clientAccountRepository.js"
import { createEmailDeliveryRepository } from "../repositories/emailDeliveryRepository.js"
import { createEmailProviderEventRepository } from "../repositories/emailProviderEventRepository.js"
import { createEmailSuppressionRepository } from "../repositories/emailSuppressionRepository.js"
import { createIdempotencyRepository } from "../repositories/idempotencyRepository.js"
import { createLoginEventRepository } from "../repositories/loginEventRepository.js"
import { createOutboxRepository } from "../repositories/outboxRepository.js"
import { createUserRepository } from "../repositories/userRepository.js"
import { registerAdminIdentityRoutes } from "../routes/adminIdentityRoutes.js"
import { registerAdminCatalogRoutes } from "../routes/adminCatalogRoutes.js"
import { registerAdminContentRoutes } from "../routes/adminContentRoutes.js"
import { registerAdminOversightRoutes } from "../routes/adminOversightRoutes.js"
import { createAdminCatalogRepository } from "../repositories/adminCatalogRepository.js"
import { createAdminContentRepository } from "../repositories/adminContentRepository.js"
import { createAdminOversightRepository } from "../repositories/adminOversightRepository.js"
import { registerClientAccountRoutes } from "../routes/clientAccountRoutes.js"
import { registerClientKycRoutes } from "../routes/clientKycRoutes.js"
import { registerClientOrderRoutes } from "../routes/clientOrderRoutes.js"
import { registerClientCatalogRoutes } from "../routes/clientCatalogRoutes.js"
import { registerClientPortfolioRoutes } from "../routes/clientPortfolioRoutes.js"
import { registerClientSipRoutes } from "../routes/clientSipRoutes.js"
import { registerPublicContentRoutes } from "../routes/publicContentRoutes.js"
import { registerPublicAppRoutes } from "../routes/publicAppRoutes.js"
import { createRedisCache, createUncachedCache } from "../cache/cache.js"
import { createRedisClient } from "../cache/redisClient.js"
import { registerMandateWebhookRoutes } from "../routes/mandateWebhookRoutes.js"
import { registerPaymentWebhookRoutes } from "../routes/paymentWebhookRoutes.js"
import { registerNativeAuthRoutes } from "../routes/nativeAuthRoutes.js"
import { registerProviderEventRoutes } from "../routes/providerEventRoutes.js"
import { registerPublicOnboardingRoutes } from "../routes/publicOnboardingRoutes.js"
import { registerWebAuthRoutes } from "../routes/webAuthRoutes.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { createReadinessCheck, registerHealthRoutes, type ReadinessReport } from "./health.js"
import { parseServerConfig } from "./environment.js"

export interface BackendServices {
  readonly registerRoutes: (application: FastifyInstance) => void
  /** Browser origins allowed to call this API cross-origin (drives CORS). */
  readonly corsAllowlist: readonly string[]
  readonly checkReadiness: () => Promise<ReadinessReport>
  readonly dispose: () => Promise<void>
}

export const composeBackend = (source: Readonly<Record<string, string | undefined>>): BackendServices => {
  const databaseConfig = parseDatabaseConfig(source)
  const cryptoKeys = parseCryptoKeys(source)
  const serverConfig = parseServerConfig(source)
  const breachMode = resolveBreachCheckMode(source)

  let cacheDegradedLogged = false
  const reportCacheDegraded = (error: unknown, operation?: string): void => {
    if (cacheDegradedLogged) return
    cacheDegradedLogged = true
    const detail = operation === undefined ? "" : ` during ${operation}`
    console.warn(
      `cache unavailable${detail}; serving every read from PostgreSQL: ${String(error)}`,
    )
  }

  const pool = createPool(databaseConfig)
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const clock = (): Date => new Date()

  // Bound Argon2id concurrency process-wide before anything can hash. Every
  // password hash and verification goes through this gate, so overload is
  // rejected with a retryable 429 instead of queueing behind the threadpool.
  configurePasswordWorkGate(serverConfig.passwordHashing)

  const cache =
    serverConfig.cache.configured && serverConfig.cache.redisUrl !== null
      ? createRedisCache({
          namespace: serverConfig.cache.namespace,
          client: createRedisClient({
            config: {
              url: serverConfig.cache.redisUrl,
              connectTimeoutMs: serverConfig.cache.connectTimeoutMs,
              commandTimeoutMs: serverConfig.cache.commandTimeoutMs,
              maxRetriesPerRequest: serverConfig.cache.maxRetriesPerRequest,
            },
            onConnectionError: (error) => {
              reportCacheDegraded(error)
            },
          }),
          onError: (error, operation) => {
            reportCacheDegraded(error, operation)
          },
        })
      : createUncachedCache()

  const crypto = createCryptoContext(cryptoKeys)
  const accessTokenService = createAccessTokenService(serverConfig.access)
  const breachChecker = createBreachChecker(breachMode)
  const certificateFetcher = createCertificateFetcher()

  const applicationRepository = createApplicationRepository()
  const applicationReviewRepository = createApplicationReviewRepository()
  const consentRepository = createConsentRepository()
  const userRepository = createUserRepository()
  const credentialRepository = createCredentialRepository()
  const authSessionRepository = createAuthSessionRepository()
  const auditRepository = createAuditRepository()
  const loginEventRepository = createLoginEventRepository()
  const outboxRepository = createOutboxRepository()
  const emailDeliveryRepository = createEmailDeliveryRepository()
  const emailProviderEventRepository = createEmailProviderEventRepository()
  const emailSuppressionRepository = createEmailSuppressionRepository()
  const idempotencyRepository = createIdempotencyRepository()
  const clientPortfolioRepository = createClientPortfolioRepository()
  const orderRepository = createOrderRepository()
  const paymentRepository = createPaymentRepository()
  const investorLedgerRepository = createInvestorLedgerRepository()
  const redemptionRepository = createRedemptionRepository()
  const notificationRepository = createNotificationRepository()
  const sipRepository = createSipRepository()
  const mandateRepository = createMandateRepository()
  const kycRepository = createKycRepository()
  const clientAccountRepository = createClientAccountRepository()

  // KYC/transactional email sender: real SMTP when configured; otherwise fail
  // closed so the API never reports `code_sent` for a message that did not leave.
  const emailFromAddress =
    serverConfig.email.fromAddress ?? serverConfig.email.smtp?.user ?? "no-reply@localhost"
  const emailSender: EmailSender =
    serverConfig.email.smtp !== null
      ? createSmtpEmailSender({ ...serverConfig.email.smtp, fromAddress: emailFromAddress })
      : createUnconfiguredEmailSender()

  const webAuth: WebAuthDeps = {
    userRepository,
    authSessionRepository,
    auditRepository,
    accessTokenService,
    database,
    refreshKey: serverConfig.refreshKey,
    refreshKeyVersion: serverConfig.refreshKeyVersion,
    csrfKeyVersion: serverConfig.csrfKeyVersion,
    clock,
    config: { cookieSecure: serverConfig.web.cookieSecure, originAllowlist: serverConfig.web.originAllowlist },
  }

  const checkReadiness = createReadinessCheck(
    database,
    serverConfig.email.smtp !== null,
    serverConfig.emailConfigured,
  )

  // Shared by the admin content routes and the public app-config read.
  const adminContentRepository = createAdminContentRepository()

  const registerRoutes = (application: FastifyInstance): void => {
    registerHealthRoutes(application, { checkReadiness })

    registerPublicOnboardingRoutes(application, {
      database,
      unitOfWork,
      clock,
      crypto,
      breachChecker,
      config: {
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
        signupSharedSecret: serverConfig.signup.sharedSecret,
      },
      applicationRepository,
      consentRepository,
      auditRepository,
      idempotencyRepository,
    })

    registerNativeAuthRoutes(application, {
      userRepository,
      authSessionRepository,
      auditRepository,
      loginEventRepository,
      accessTokenService,
      database,
      refreshKey: serverConfig.refreshKey,
      refreshKeyVersion: serverConfig.refreshKeyVersion,
      clock,
      deviceLimit: serverConfig.deviceLimit,
      unitOfWork,
      logger: application.log,
    })

    registerClientPortfolioRoutes(application, {
      accessTokenService,
      database,
      clientPortfolioRepository,
      investorLedgerRepository,
      redemptionRepository,
      auditRepository,
      unitOfWork,
      clock,
      config: { cursorKey: serverConfig.cursorKey },
    })

    // Published fund catalogue for the client app (AUM-proportional pool view).
    registerClientCatalogRoutes(application, {
      accessTokenService,
      database,
      clock,
      cache,
      config: { cursorKey: serverConfig.cursorKey, catalogTtlMs: serverConfig.cache.catalogTtlMs },
      clientCatalogRepository: createClientCatalogRepository(),
    })

    registerClientOrderRoutes(application, {
      accessTokenService,
      database,
      unitOfWork,
      clock,
      orderRepository,
      paymentRepository,
      userRepository,
      outboxRepository,
      auditRepository,
      idempotencyRepository,
      config: {
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
        // Provider + attempt window come from the environment; the provider-call
        // outbox event is the durable trigger the settlement worker consumes.
        paymentProvider: serverConfig.payments.provider,
        attemptTtlMs: serverConfig.payments.attemptTtlMs,
      },
    })

    // The signed payment webhook (real-gateway paid/failed confirmation) is only
    // wired when a webhook secret is configured; the mock provider is auto-settled
    // by the payment worker instead.
    if (serverConfig.payments.webhookConfigured && serverConfig.payments.webhookSecret !== null) {
      registerPaymentWebhookRoutes(application, {
        unitOfWork,
        clock,
        paymentRepository,
        orderRepository,
        investorLedgerRepository,
        notificationRepository,
        auditRepository,
        config: {
          paymentProvider: serverConfig.payments.provider,
          webhookSecret: serverConfig.payments.webhookSecret,
        },
      })
      registerMandateWebhookRoutes(application, {
        unitOfWork,
        clock,
        mandateRepository,
        sipRepository,
        auditRepository,
        config: { webhookSecret: serverConfig.payments.webhookSecret },
      })
    }

    registerClientSipRoutes(application, {
      accessTokenService,
      database,
      unitOfWork,
      clock,
      sipRepository,
      mandateRepository,
      orderRepository,
      userRepository,
      outboxRepository,
      auditRepository,
      idempotencyRepository,
      config: {
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
        paymentProvider: serverConfig.payments.provider,
        mandateFrequency: "monthly",
      },
    })

    registerClientKycRoutes(application, {
      accessTokenService,
      database,
      unitOfWork,
      clock,
      crypto,
      kycRepository,
      userRepository,
      auditRepository,
      emailSender,
      config: {
        codeTtlMs: serverConfig.kyc.codeTtlMs,
        maxAttempts: serverConfig.kyc.maxAttempts,
        resendCooldownMs: serverConfig.kyc.resendCooldownMs,
        validityMs: serverConfig.kyc.validityMs,
      },
    })

    // Inbox, payment history, derived statements, support and research context.
    registerClientAccountRoutes(application, {
      accessTokenService,
      database,
      clientAccountRepository,
      investorLedgerRepository,
      auditRepository,
      notificationRepository,
      unitOfWork,
      clock,
      // Same release directory the public update feed reads, so the inbox and
      // the launch dialog always agree on the newest build.
      appUpdate: serverConfig.appUpdate,
    })

    // Compliance documents, readable without a session.
    registerPublicContentRoutes(application, {
      clientAccountRepository,
      unitOfWork,
      cache,
      config: { publicContentTtlMs: serverConfig.cache.publicContentTtlMs },
    })

    // App configuration + APK update check, both called before login.
    registerPublicAppRoutes(application, {
      adminContentRepository,
      unitOfWork,
      cache,
      appUpdate: serverConfig.appUpdate,
      config: { appConfigTtlMs: serverConfig.cache.appConfigTtlMs },
    })

    registerWebAuthRoutes(application, {
      ...webAuth,
      unitOfWork,
      loginEventRepository,
      logger: application.log,
    })

    registerAdminIdentityRoutes(application, {
      webAuth,
      unitOfWork,
      database,
      clock,
      crypto,
      config: {
        cursorKey: serverConfig.cursorKey,
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
        sesConfigurationSet: serverConfig.sesConfigurationSet,
      },
      appUpdate: serverConfig.appUpdate,
      applicationRepository,
      applicationReviewRepository,
      userRepository,
      credentialRepository,
      outboxRepository,
      emailDeliveryRepository,
      auditRepository,
      idempotencyRepository,
    })

    // Admin content/catalog/oversight groups: the console's site content, fund
    // catalogue, and supervision reads over authoritative evidence.
    registerAdminContentRoutes(application, {
      cache,
      webAuth,
      unitOfWork,
      database,
      clock,
      config: {
        cursorKey: serverConfig.cursorKey,
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
      },
      contentRepository: adminContentRepository,
      auditRepository,
      idempotencyRepository,
    })

    registerAdminCatalogRoutes(application, {
      webAuth,
      notificationRepository,
      unitOfWork,
      database,
      clock,
      config: {
        cursorKey: serverConfig.cursorKey,
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
      },
      catalogRepository: createAdminCatalogRepository(),
      investorLedgerRepository,
      auditRepository,
      idempotencyRepository,
    })

    registerAdminOversightRoutes(application, {
      webAuth,
      unitOfWork,
      database,
      clock,
      config: {
        cursorKey: serverConfig.cursorKey,
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
      },
      oversightRepository: createAdminOversightRepository(),
      loginEventRepository,
      investorLedgerRepository,
      redemptionRepository,
      notificationRepository,
      auditRepository,
      idempotencyRepository,
    })
    // configured; a deployment without AWS boots without it (email degraded).
    const { awsRegion, topicArn, ttlMs } = serverConfig.providerEvents
    if (awsRegion !== null && topicArn !== null) {
      registerProviderEventRoutes(application, {
        unitOfWork,
        clock,
        certificateFetcher,
        config: {
          awsRegion,
          topicArn,
          providerEventTtlMs: ttlMs,
        },
        emailProviderEventRepository,
        emailDeliveryRepository,
        emailSuppressionRepository,
      })
    }
  }

  return {
    registerRoutes,
    corsAllowlist: serverConfig.web.originAllowlist,
    checkReadiness,
    dispose: async () => {
      await cache.close()
      await pool.end()
    },
  }
}

export interface PaymentSettlementWorker {
  /** Run one settlement pass over the due `payment` provider-call outbox events. */
  readonly runOnce: () => Promise<SettleSummary>
  readonly dispose: () => Promise<void>
}

/**
 * Compose the payment settlement worker (spec 03 §5.2, §6). A separate entrypoint
 * from the HTTP server: it owns its own pool and drains the `payment`
 * provider-call outbox, driving each payment `send -> confirm -> book` with the
 * placeholder "manual" provider (instant success). A real gateway swaps in a
 * genuine dispatch + signed webhook without changing the claim/lease/retry loop.
 */
export const composePaymentSettlementWorker = (
  source: Readonly<Record<string, string | undefined>>,
): PaymentSettlementWorker => {
  const databaseConfig = parseDatabaseConfig(source)
  const pool = createPool(databaseConfig)
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const clock = (): Date => new Date()

  const workerId = source.WORKER_ID ?? "payment-worker"
  const claimLimit = Math.min(Math.max(Number(source.PAYMENT_WORKER_CLAIM_LIMIT ?? 50), 1), 100)
  const leaseMs = Math.max(Number(source.PAYMENT_WORKER_LEASE_MS ?? 60_000), 1_000)
  const paymentProvider = source.PAYMENT_PROVIDER ?? "manual"

  const deps = {
    unitOfWork,
    outboxRepository: createOutboxRepository(),
    paymentRepository: createPaymentRepository(),
    orderRepository: createOrderRepository(),
    investorLedgerRepository: createInvestorLedgerRepository(),
    notificationRepository: createNotificationRepository(),
    auditRepository: createAuditRepository(),
    clock,
    config: { paymentProvider },
    // The mock provider is auto-settled to booked in the pass; a real gateway is
    // only dispatched here and confirmed later via the signed webhook.
    settleConfig: { topic: "payment", workerId, leaseMs, claimLimit, autoConfirm: paymentProvider === "manual" },
  }

  return {
    runOnce: () => settleDuePayments(deps),
    dispose: async () => {
      await pool.end()
    },
  }
}

export interface EmailDispatchWorker {
  /** Run one delivery pass over the due `email` outbox events. */
  readonly runOnce: () => Promise<DispatchSummary>
  /**
   * Whether an SMTP transport was actually configured for this process.
   *
   * Exposed so the entrypoint can say so out loud. Without a transport every
   * send fails retryably and the queue silently accumulates: the failure is
   * recorded honestly per delivery (`EMAIL_TRANSPORT_NOT_CONFIGURED`), but
   * nothing announced that the cause was a missing setting rather than a mail
   * server having a bad day. A dev stack ran in that state for a day and the only
   * symptom anyone noticed was applicants reporting no confirmation email.
   */
  readonly transportConfigured: boolean
  readonly dispose: () => Promise<void>
}

/**
 * Composes the outbox email delivery worker. Without this process the onboarding
 * emails — address verification and the activation invite — stay queued forever
 * and nobody can activate an account, so the deploy stack runs it alongside the
 * payment and SIP workers.
 *
 * The sender is the same company mailbox the KYC codes use. Without SMTP it
 * fails retryably so durable delivery state never claims an unsent message.
 */
export const composeEmailDispatchWorker = (
  source: Readonly<Record<string, string | undefined>>,
): EmailDispatchWorker => {
  const pool = createPool(parseDatabaseConfig(source))
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const serverConfig = parseServerConfig(source)
  const crypto = createCryptoContext(parseCryptoKeys(source))

  const fromAddress = serverConfig.email.fromAddress ?? serverConfig.email.smtp?.user ?? "no-reply@localhost"
  /*
   * No log sender here. This path records durable evidence of delivery, so a
   * sender that resolves without sending anything makes `email_deliveries.state`
   * a lie (see createUnconfiguredEmailSender). Without SMTP the pass fails
   * retryably and the queue drains once it is configured.
   */
  const transport: EmailSender =
    serverConfig.email.smtp !== null
      ? createSmtpEmailSender({ ...serverConfig.email.smtp, fromAddress })
      : createUnconfiguredEmailSender()

  const deps = {
    unitOfWork,
    outboxRepository: createOutboxRepository(),
    emailDeliveryRepository: createEmailDeliveryRepository(),
    emailSuppressionRepository: createEmailSuppressionRepository(),
    sender: createTransactionalEmailSender({ sender: transport, templates: serverConfig.email.links }),
    crypto,
    clock: (): Date => new Date(),
    config: {
      topic: "email",
      workerId: source.WORKER_ID ?? "email-worker",
      leaseMs: serverConfig.email.worker.leaseMs,
      claimLimit: serverConfig.email.worker.claimLimit,
    },
  }

  return {
    runOnce: () => dispatchDueDeliveries(deps),
    transportConfigured: serverConfig.email.smtp !== null,
    dispose: async () => {
      await pool.end()
    },
  }
}

export interface SipInstallmentWorker {
  /** Run one pass generating installment orders for due active SIPs. */
  readonly runOnce: () => Promise<GenerateSipInstallmentsSummary>
  readonly dispose: () => Promise<void>
}

/**
 * Compose the SIP installment scheduler (spec 03 §5.2). A separate entrypoint
 * that, per pass, creates a `sip_installment` order for each due active SIP and
 * begins its payment; the payment worker + webhook then settle and book it.
 */
export const composeSipInstallmentWorker = (
  source: Readonly<Record<string, string | undefined>>,
): SipInstallmentWorker => {
  const pool = createPool(parseDatabaseConfig(source))
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const clock = (): Date => new Date()

  const limit = Math.min(Math.max(Number(source.SIP_WORKER_CLAIM_LIMIT ?? 50), 1), 100)
  const paymentProvider = source.PAYMENT_PROVIDER ?? "manual"
  const attemptTtlMs = Math.max(Number(source.PAYMENT_ATTEMPT_TTL_MS ?? 900_000), 1_000)

  const deps = {
    unitOfWork,
    sipRepository: createSipRepository(),
    orderRepository: createOrderRepository(),
    userRepository: createUserRepository(),
    paymentRepository: createPaymentRepository(),
    outboxRepository: createOutboxRepository(),
    auditRepository: createAuditRepository(),
    clock,
    config: { limit, paymentProvider, attemptTtlMs },
  }

  return {
    runOnce: () => generateSipInstallments(deps),
    dispose: async () => {
      await pool.end()
    },
  }
}
