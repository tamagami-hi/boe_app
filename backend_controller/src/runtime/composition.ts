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
import { createCryptoContext, parseCryptoKeys } from "../crypto/context.js"
import { createDatabase, createUnitOfWork } from "../db/database.js"
import { parseDatabaseConfig } from "../db/config.js"
import { createPool } from "../db/pool.js"
import { createCertificateFetcher } from "../email/certificateFetcher.js"
import { createActivationInviteRepository } from "../repositories/activationInviteRepository.js"
import { createApplicationRepository } from "../repositories/applicationRepository.js"
import { createClientPortfolioRepository } from "../repositories/clientPortfolioRepository.js"
import { createHoldingRepository } from "../repositories/holdingRepository.js"
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
import { createEmailDeliveryRepository } from "../repositories/emailDeliveryRepository.js"
import { createEmailProviderEventRepository } from "../repositories/emailProviderEventRepository.js"
import { createEmailSuppressionRepository } from "../repositories/emailSuppressionRepository.js"
import { createIdempotencyRepository } from "../repositories/idempotencyRepository.js"
import { createOutboxRepository } from "../repositories/outboxRepository.js"
import { createUserRepository } from "../repositories/userRepository.js"
import { createVerificationTokenRepository } from "../repositories/verificationTokenRepository.js"
import { registerAdminIdentityRoutes } from "../routes/adminIdentityRoutes.js"
import { registerClientOrderRoutes } from "../routes/clientOrderRoutes.js"
import { registerClientPortfolioRoutes } from "../routes/clientPortfolioRoutes.js"
import { registerClientSipRoutes } from "../routes/clientSipRoutes.js"
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
  readonly checkReadiness: () => Promise<ReadinessReport>
  readonly dispose: () => Promise<void>
}

export const composeBackend = (source: Readonly<Record<string, string | undefined>>): BackendServices => {
  const databaseConfig = parseDatabaseConfig(source)
  const cryptoKeys = parseCryptoKeys(source)
  const serverConfig = parseServerConfig(source)
  const breachMode = resolveBreachCheckMode(source)

  const pool = createPool(databaseConfig)
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const clock = (): Date => new Date()

  const crypto = createCryptoContext(cryptoKeys)
  const accessTokenService = createAccessTokenService(serverConfig.access)
  const breachChecker = createBreachChecker(breachMode)
  const certificateFetcher = createCertificateFetcher()

  const applicationRepository = createApplicationRepository()
  const applicationReviewRepository = createApplicationReviewRepository()
  const consentRepository = createConsentRepository()
  const verificationTokenRepository = createVerificationTokenRepository()
  const userRepository = createUserRepository()
  const credentialRepository = createCredentialRepository()
  const activationInviteRepository = createActivationInviteRepository()
  const authSessionRepository = createAuthSessionRepository()
  const auditRepository = createAuditRepository()
  const outboxRepository = createOutboxRepository()
  const emailDeliveryRepository = createEmailDeliveryRepository()
  const emailProviderEventRepository = createEmailProviderEventRepository()
  const emailSuppressionRepository = createEmailSuppressionRepository()
  const idempotencyRepository = createIdempotencyRepository()
  const clientPortfolioRepository = createClientPortfolioRepository()
  const orderRepository = createOrderRepository()
  const paymentRepository = createPaymentRepository()
  const holdingRepository = createHoldingRepository()
  const notificationRepository = createNotificationRepository()
  const sipRepository = createSipRepository()
  const mandateRepository = createMandateRepository()

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

  const checkReadiness = createReadinessCheck(database, serverConfig.emailConfigured)

  const registerRoutes = (application: FastifyInstance): void => {
    registerHealthRoutes(application, { checkReadiness })

    registerPublicOnboardingRoutes(application, {
      database,
      unitOfWork,
      clock,
      crypto,
      config: {
        verificationTokenTtlMs: serverConfig.ttls.verificationTokenTtlMs,
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
        sesConfigurationSet: serverConfig.sesConfigurationSet,
      },
      applicationRepository,
      consentRepository,
      verificationTokenRepository,
      emailDeliveryRepository,
      outboxRepository,
      auditRepository,
      idempotencyRepository,
    })

    registerNativeAuthRoutes(application, {
      userRepository,
      activationInviteRepository,
      credentialRepository,
      authSessionRepository,
      auditRepository,
      crypto,
      breachChecker,
      accessTokenService,
      database,
      refreshKey: serverConfig.refreshKey,
      refreshKeyVersion: serverConfig.refreshKeyVersion,
      clock,
      unitOfWork,
    })

    registerClientPortfolioRoutes(application, {
      accessTokenService,
      database,
      clientPortfolioRepository,
      clock,
      config: { cursorKey: serverConfig.cursorKey },
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
        holdingRepository,
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

    registerWebAuthRoutes(application, { ...webAuth, unitOfWork })

    registerAdminIdentityRoutes(application, {
      webAuth,
      unitOfWork,
      database,
      clock,
      crypto,
      config: {
        cursorKey: serverConfig.cursorKey,
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
        activationInviteTtlMs: serverConfig.ttls.activationInviteTtlMs,
        sesConfigurationSet: serverConfig.sesConfigurationSet,
      },
      applicationRepository,
      applicationReviewRepository,
      userRepository,
      activationInviteRepository,
      outboxRepository,
      emailDeliveryRepository,
      auditRepository,
      idempotencyRepository,
    })

    // The signed SNS provider-event ingress is only wired when AWS SES/SNS is
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
    checkReadiness,
    dispose: async () => {
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
    holdingRepository: createHoldingRepository(),
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
