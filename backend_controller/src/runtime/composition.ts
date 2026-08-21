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
import { createClientValueEntryRepository } from "../repositories/clientValueEntryRepository.js"
import { createKycRepository } from "../repositories/kycRepository.js"
import {
  createSmtpEmailSender,
  createUnconfiguredEmailSender,
  type EmailSender,
} from "../email/emailSender.js"
import { createNotificationRepository } from "../repositories/notificationRepository.js"
import { createOrderRepository } from "../repositories/orderRepository.js"
import { createPaymentsRepository } from "../repositories/paymentsRepository.js"
import { createRefundRepository } from "../repositories/refundRepository.js"
import { createInvestmentReviewRepository } from "../repositories/investmentReviewRepository.js"
import { createProviderEventInboxRepository } from "../repositories/providerEventInboxRepository.js"
import { createPhonePeCheckoutGateway } from "../providers/phonepe/phonePeCheckoutGateway.js"
import type { PaymentGateway } from "../providers/phonepe/paymentGateway.js"
import { runReconciliationPass, type ReconciliationSummary } from "../paymentReconciliationWorker.js"
import { runSipSchedulePass, type SipScheduleSummary } from "../sipScheduleWorker.js"
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
import { registerAdminAumRoutes } from "../routes/adminAumRoutes.js"
import { registerAdminFundGrowthPreviewRoutes } from "../routes/adminFundGrowthPreviewRoutes.js"
import { registerAdminInvestmentReviewRoutes } from "../routes/adminInvestmentReviewRoutes.js"
import { registerAdminCatalogRoutes } from "../routes/adminCatalogRoutes.js"
import { registerAdminClientGrowthRoutes } from "../routes/adminClientGrowthRoutes.js"
import { registerAdminContentRoutes } from "../routes/adminContentRoutes.js"
import { registerAdminOversightRoutes } from "../routes/adminOversightRoutes.js"
import { createAdminCatalogRepository } from "../repositories/adminCatalogRepository.js"
import { createFundAumRepository } from "../repositories/fundAumRepository.js"
import { createAdminContentRepository } from "../repositories/adminContentRepository.js"
import { createAdminOversightRepository } from "../repositories/adminOversightRepository.js"
import { createClientGrowthRepository } from "../repositories/clientGrowthRepository.js"
import { registerClientAccountRoutes } from "../routes/clientAccountRoutes.js"
import { registerClientKycRoutes } from "../routes/clientKycRoutes.js"
import { registerClientOrderRoutes } from "../routes/clientOrderRoutes.js"
import { registerClientSipPlanRoutes } from "../routes/clientSipPlanRoutes.js"
import { createSipPlanRepository } from "../repositories/sipPlanRepository.js"
import { registerClientCatalogRoutes } from "../routes/clientCatalogRoutes.js"
import { registerClientPortfolioRoutes } from "../routes/clientPortfolioRoutes.js"
import { registerPublicContentRoutes } from "../routes/publicContentRoutes.js"
import { registerPublicAppRoutes } from "../routes/publicAppRoutes.js"
import { createRedisCache, createUncachedCache } from "../cache/cache.js"
import { createRedisClient } from "../cache/redisClient.js"
import { registerNativeAuthRoutes } from "../routes/nativeAuthRoutes.js"
import { registerProviderEventRoutes } from "../routes/providerEventRoutes.js"
import { registerPhonePeProviderEventRoutes } from "../routes/phonePeProviderEventRoutes.js"
import { registerPublicOnboardingRoutes } from "../routes/publicOnboardingRoutes.js"
import { registerWebAuthRoutes } from "../routes/webAuthRoutes.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { createReadinessCheck, registerHealthRoutes, type ReadinessReport } from "./health.js"
import { parseServerConfig } from "./environment.js"

export interface BackendServices {
  readonly registerRoutes: (application: FastifyInstance) => void
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
  const paymentGateway: PaymentGateway | null =
    serverConfig.payments.phonepe !== null
      ? createPhonePeCheckoutGateway({ config: serverConfig.payments.phonepe })
      : null

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
  const clientValueEntryRepository = createClientValueEntryRepository()
  const orderRepository = createOrderRepository()
  const paymentsRepository = createPaymentsRepository()
  const refundRepository = createRefundRepository()
  const investmentReviewRepository = createInvestmentReviewRepository()
  const providerEventInboxRepository = createProviderEventInboxRepository()
  const notificationRepository = createNotificationRepository()
  const kycRepository = createKycRepository()
  const clientAccountRepository = createClientAccountRepository()

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
      clientValueEntryRepository,
      unitOfWork,
      clock,
      config: { cursorKey: serverConfig.cursorKey },
    })

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
      userRepository,
      auditRepository,
      idempotencyRepository,
      paymentsRepository,
      paymentGateway,
      config: {
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
        attemptTtlMs: serverConfig.payments.attemptTtlMs,
      },
    })

    registerClientSipPlanRoutes(application, {
      accessTokenService,
      database,
      unitOfWork,
      clock,
      sipPlanRepository: createSipPlanRepository(),
      orderRepository,
      userRepository,
      auditRepository,
      notificationRepository,
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

    registerClientAccountRoutes(application, {
      accessTokenService,
      database,
      clientAccountRepository,
      clientValueEntryRepository,
      auditRepository,
      notificationRepository,
      unitOfWork,
      clock,
      appUpdate: serverConfig.appUpdate,
    })

    registerPublicContentRoutes(application, {
      clientAccountRepository,
      unitOfWork,
      cache,
      config: { publicContentTtlMs: serverConfig.cache.publicContentTtlMs },
    })

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

    const fundAumRepository = createFundAumRepository()

    registerAdminCatalogRoutes(application, {
      webAuth,
      unitOfWork,
      database,
      clock,
      config: {
        cursorKey: serverConfig.cursorKey,
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
      },
      catalogRepository: createAdminCatalogRepository(),
      aumRepository: fundAumRepository,
      auditRepository,
      idempotencyRepository,
    })

    const adminAumDeps = {
      webAuth,
      unitOfWork,
      database,
      clock,
      config: {
        cursorKey: serverConfig.cursorKey,
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
      },
      aumRepository: fundAumRepository,
      auditRepository,
      idempotencyRepository,
    }
    registerAdminAumRoutes(application, adminAumDeps)
    registerAdminFundGrowthPreviewRoutes(application, adminAumDeps)

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
      auditRepository,
      idempotencyRepository,
    })

    registerAdminClientGrowthRoutes(application, {
      webAuth,
      unitOfWork,
      database,
      clock,
      config: {
        idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
        maxBasisPoints: serverConfig.clientGrowth.maxBasisPoints,
      },
      clientGrowthRepository: createClientGrowthRepository(),
      auditRepository,
      idempotencyRepository,
      notificationRepository,
    })

    if (paymentGateway !== null) {
      registerAdminInvestmentReviewRoutes(application, {
        webAuth,
        unitOfWork,
        database,
        clock,
        config: { idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs },
        reviewRepository: investmentReviewRepository,
        paymentsRepository,
        refundRepository,
        paymentGateway,
        auditRepository,
        idempotencyRepository,
      })
    }
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

    if (paymentGateway !== null) {
      registerPhonePeProviderEventRoutes(application, {
        unitOfWork,
        clock,
        paymentGateway,
        config: {
          payloadEncryptionKey: cryptoKeys.recipientEncryptionKey,
          payloadKeyVersion: cryptoKeys.recipientEncryptionKeyVersion,
        },
        providerEventInboxRepository,
        paymentsRepository,
        refundRepository,
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

export interface EmailDispatchWorker {
  readonly runOnce: () => Promise<DispatchSummary>
  readonly transportConfigured: boolean
  readonly dispose: () => Promise<void>
}

export const composeEmailDispatchWorker = (
  source: Readonly<Record<string, string | undefined>>,
): EmailDispatchWorker => {
  const pool = createPool(parseDatabaseConfig(source))
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const serverConfig = parseServerConfig(source)
  const crypto = createCryptoContext(parseCryptoKeys(source))

  const fromAddress = serverConfig.email.fromAddress ?? serverConfig.email.smtp?.user ?? "no-reply@localhost"
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

export interface PaymentReconciliationWorker {
  readonly runOnce: () => Promise<ReconciliationSummary>
  readonly gatewayConfigured: boolean
  readonly dispose: () => Promise<void>
}

export const composePaymentReconciliationWorker = (
  source: Readonly<Record<string, string | undefined>>,
): PaymentReconciliationWorker => {
  const pool = createPool(parseDatabaseConfig(source))
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const serverConfig = parseServerConfig(source)

  const gateway =
    serverConfig.payments.phonepe !== null
      ? createPhonePeCheckoutGateway({ config: serverConfig.payments.phonepe })
      : null

  return {
    runOnce: async () => {
      if (gateway === null) {
        return { attemptsChecked: 0, attemptsResolved: 0, refundsChecked: 0, refundsResolved: 0 }
      }
      return runReconciliationPass({
        unitOfWork,
        clock: (): Date => new Date(),
        paymentGateway: gateway,
        paymentsRepository: createPaymentsRepository(),
        refundRepository: createRefundRepository(),
        config: {
          claimLimit: 25,
          staleAfterMs: serverConfig.payments.attemptTtlMs,
        },
      })
    },
    gatewayConfigured: gateway !== null,
    dispose: async () => {
      await pool.end()
    },
  }
}

export interface SipScheduleWorker {
  readonly runOnce: () => Promise<SipScheduleSummary>
  readonly dispose: () => Promise<void>
}

export const composeSipScheduleWorker = (
  source: Readonly<Record<string, string | undefined>>,
): SipScheduleWorker => {
  const pool = createPool(parseDatabaseConfig(source))
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)

  return {
    runOnce: () =>
      runSipSchedulePass({
        unitOfWork,
        clock: (): Date => new Date(),
        sipPlanRepository: createSipPlanRepository(),
        orderRepository: createOrderRepository(),
        userRepository: createUserRepository(),
        auditRepository: createAuditRepository(),
        notificationRepository: createNotificationRepository(),
        config: {
          claimLimit: 200,
          maxPeriodsPerPlan: 24,
        },
      }),
    dispose: async () => {
      await pool.end()
    },
  }
}

