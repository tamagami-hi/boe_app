import type { FastifyInstance } from "fastify"

import { createConfirmationAttemptLimiter } from "../auth/confirmationAttemptLimiter.js"
import { createFixedWindowRateLimiter } from "../http/rateLimit.js"
import { createAccountingReportRepository } from "../repositories/accountingReportRepository.js"
import { createAdminCatalogRepository } from "../repositories/adminCatalogRepository.js"
import { createAdminOversightRepository } from "../repositories/adminOversightRepository.js"
import { createAuditTrailRepository } from "../repositories/auditTrailRepository.js"
import { createAdminSipScheduleRepository } from "../repositories/adminSipScheduleRepository.js"
import { createAdminStepUpRepository } from "../repositories/adminStepUpRepository.js"
import { createClientErasureDeleteRepository } from "../repositories/clientErasureDeleteRepository.js"
import { createClientErasureInspectRepository } from "../repositories/clientErasureInspectRepository.js"
import { createClientErasureWriteRepository } from "../repositories/clientErasureWriteRepository.js"
import { createClientGrowthMailRepository } from "../repositories/clientGrowthMailRepository.js"
import { createClientReturnsRepository } from "../repositories/clientReturnsRepository.js"
import { createEmailChangeRepository } from "../repositories/emailChangeRepository.js"
import { createEmailVerificationRepository } from "../repositories/emailVerificationRepository.js"
import { createMandatesRepository } from "../repositories/mandatesRepository.js"
import { createFundAumRepository } from "../repositories/fundAumRepository.js"
import { createMaturityRepository } from "../repositories/maturityRepository.js"
import { createMonthlyRecordingSheetRepository } from "../repositories/monthlyRecordingSheetRepository.js"
import { createPasswordTokenRepository } from "../repositories/passwordTokenRepository.js"
import { createUserContactRepository } from "../repositories/userContactRepository.js"
import { registerAdminAuditTrailRoutes } from "../routes/adminAuditTrailRoutes.js"
import { registerAdminAumRoutes } from "../routes/adminAumRoutes.js"
import { registerAdminCatalogRoutes } from "../routes/adminCatalogRoutes.js"
import { registerAdminClientErasureRoutes } from "../routes/adminClientErasureRoutes.js"
import { registerAdminClientGrowthRoutes, type AdminClientGrowthDeps } from "../routes/adminClientGrowthRoutes.js"
import { registerAdminClientReturnRoutes, type AdminClientReturnDeps } from "../routes/adminClientReturnRoutes.js"
import { registerAdminContentRoutes, type AdminContentDeps } from "../routes/adminContentRoutes.js"
import { registerAdminFundGrowthPreviewRoutes } from "../routes/adminFundGrowthPreviewRoutes.js"
import { registerAdminFundReceiptRoutes, type AdminFundReceiptDeps } from "../routes/adminFundReceiptRoutes.js"
import { registerAdminIdentityRoutes, type AdminIdentityDeps } from "../routes/adminIdentityRoutes.js"
import { registerAdminMaturityRoutes, type AdminMaturityDeps } from "../routes/adminMaturityRoutes.js"
import { registerAdminOversightRoutes, type AdminOversightDeps } from "../routes/adminOversightRoutes.js"
import { registerAdminRecordingSheetRoutes } from "../routes/adminRecordingSheetRoutes.js"
import { registerAdminReportRoutes } from "../routes/adminReportRoutes.js"
import { registerAdminReviewRoutes, type AdminReviewDeps } from "../routes/adminReviewRoutes.js"
import { registerAdminSipScheduleRoutes } from "../routes/adminSipScheduleRoutes.js"
import { registerAdminStepUpRoutes } from "../routes/adminStepUpRoutes.js"
import { registerAdminSupportRoutes, type AdminSupportDeps } from "../routes/adminSupportRoutes.js"
import { registerClientSipScheduleRoutes } from "../routes/clientSipScheduleRoutes.js"
import type { ServerConfig } from "./environment.js"
import { registerMaturitySurface } from "./maturityComposition.js"
import { registerRecordingSurface, type RecordingSurfaceDeps } from "./recordingComposition.js"
import { registerSipEarlyExitSurface } from "./earlyExitComposition.js"

type AdminServerConfig = Pick<ServerConfig, "appUpdate" | "cursorKey" | "fundAum" | "sesConfigurationSet" | "ttls">

export type AdminSurfaceDeps = Omit<AdminIdentityDeps, "config" | "appUpdate"> &
  Omit<AdminContentDeps, "config" | "contentRepository" | "stepUp"> &
  Omit<AdminOversightDeps, "config" | "oversightRepository"> &
  Omit<AdminSupportDeps, "config"> &
  Omit<AdminReviewDeps, "config"> &
  Omit<AdminClientGrowthDeps, "config" | "clientGrowthMailRepository"> &
  Omit<RecordingSurfaceDeps, "config" | "sipScheduleRepository"> &
  Omit<AdminClientReturnDeps, "config" | "clientReturnsRepository"> &
  Omit<AdminMaturityDeps, "config" | "maturityRepository"> &
  Omit<AdminFundReceiptDeps, "config" | "acknowledgementRepository"> &
  Readonly<{
    adminContentRepository: AdminContentDeps["contentRepository"]
    fundReceiptAcknowledgementRepository: AdminFundReceiptDeps["acknowledgementRepository"]
    serverConfig: AdminServerConfig
  }>

export const registerAdminSurface = (application: FastifyInstance, deps: AdminSurfaceDeps): void => {
  const { webAuth, unitOfWork, database, clock, crypto, cache, accessTokenService, clientWeb, serverConfig } = deps
  const { applicationRepository, identityLockRepository, applicationReviewRepository, userRepository } = deps
  const { credentialRepository, outboxRepository, emailDeliveryRepository, auditRepository, idempotencyRepository } = deps
  const { adminContentRepository, loginEventRepository, authSessionRepository, notificationRepository } = deps
  const { clientGrowthRepository, clientPositionRepository, fundReceiptAcknowledgementRepository } = deps
  const { paymentsRepository, settlementRepository, refundRepository, paymentGateway } = deps

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
    identityLockRepository,
    applicationReviewRepository,
    userRepository,
    credentialRepository,
    outboxRepository,
    emailDeliveryRepository,
    auditRepository,
    idempotencyRepository,
  })

  const stepUpRepository = createAdminStepUpRepository()
  registerAdminStepUpRoutes(application, {
    webAuth,
    unitOfWork,
    database,
    userRepository,
    stepUpRepository,
    auditRepository,
    crypto,
    clock,
    confirmLimiter: createConfirmationAttemptLimiter(clock),
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
    stepUp: { stepUpRepository, crypto },
  })

  const fundAumRepository = createFundAumRepository()

  registerAdminCatalogRoutes(application, {
    webAuth,
    unitOfWork,
    database,
    clock,
    cache,
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
    cache,
    webAuth,
    unitOfWork,
    database,
    clock,
    config: {
      cursorKey: serverConfig.cursorKey,
      idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
      maxGrowthBasisPoints: serverConfig.fundAum.maxGrowthBasisPoints,
    },
    aumRepository: fundAumRepository,
    auditRepository,
    idempotencyRepository,
    rateLimiter: createFixedWindowRateLimiter(
      {
        windowMs: serverConfig.fundAum.rateLimitWindowMs,
        maxRequests: serverConfig.fundAum.rateLimitMaxRequests,
      },
      clock,
    ),
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
    authSessionRepository,
  })

  registerAdminSupportRoutes(application, {
    webAuth,
    unitOfWork,
    clock,
    config: { cursorKey: serverConfig.cursorKey, idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs },
    auditRepository,
    idempotencyRepository,
    notificationRepository,
  })

  registerAdminReviewRoutes(application, {
    webAuth,
    unitOfWork,
    clock,
    config: { cursorKey: serverConfig.cursorKey, idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs },
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
      sesConfigurationSet: serverConfig.sesConfigurationSet,
    },
    clientGrowthRepository,
    auditRepository,
    idempotencyRepository,
    notificationRepository,
    outboxRepository,
    emailDeliveryRepository,
    crypto,
    clientGrowthMailRepository: createClientGrowthMailRepository(),
  })

  const sipScheduleRepository = createAdminSipScheduleRepository()

  registerRecordingSurface(application, {
    sipScheduleRepository,
    webAuth, accessTokenService, clientWeb, unitOfWork, database, clock, outboxRepository, emailDeliveryRepository, crypto,
    clientPositionRepository, clientGrowthRepository, userRepository, auditRepository, idempotencyRepository, notificationRepository,
    config: {
      idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
      cursorKey: serverConfig.cursorKey,
      sesConfigurationSet: serverConfig.sesConfigurationSet,
    },
  })

  registerAdminSipScheduleRoutes(application, {
    webAuth, unitOfWork, database, clock, sipScheduleRepository, userRepository, auditRepository, idempotencyRepository,
    config: { idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs, cursorKey: serverConfig.cursorKey },
  })
  registerClientSipScheduleRoutes(application, { accessTokenService, clientWeb, database, clock, sipScheduleRepository })

  registerAdminClientReturnRoutes(application, {
    webAuth, database, clock, config: { cursorKey: serverConfig.cursorKey },
    clientReturnsRepository: createClientReturnsRepository(), clientPositionRepository,
  })

  const readDeps = { webAuth, database, clock, config: { cursorKey: serverConfig.cursorKey } }
  registerAdminReportRoutes(application, { ...readDeps, accountingReportRepository: createAccountingReportRepository() })
  registerAdminAuditTrailRoutes(application, { ...readDeps, auditTrailRepository: createAuditTrailRepository() })
  registerAdminRecordingSheetRoutes(application, { ...readDeps, recordingSheetRepository: createMonthlyRecordingSheetRepository() })

  const maturityRepository = createMaturityRepository()

  registerAdminMaturityRoutes(application, {
    webAuth,
    unitOfWork,
    database,
    clock,
    config: { idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs },
    maturityRepository,
    clientGrowthRepository,
    auditRepository,
    idempotencyRepository,
    notificationRepository,
  })

  const maturitySurfaceDeps = {
    webAuth, unitOfWork, database, clock, maturityRepository, clientGrowthRepository, sipScheduleRepository,
    userRepository, auditRepository, idempotencyRepository, notificationRepository, outboxRepository,
    emailDeliveryRepository, crypto, accessTokenService, clientWeb,
    config: {
      idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
      cursorKey: serverConfig.cursorKey,
      sesConfigurationSet: serverConfig.sesConfigurationSet,
    },
  }
  registerMaturitySurface(application, maturitySurfaceDeps)
  registerSipEarlyExitSurface(application, maturitySurfaceDeps)

  registerAdminClientErasureRoutes(application, {
    webAuth, unitOfWork, clock, crypto, identityLockRepository, clientGrowthRepository, authSessionRepository,
    auditRepository, idempotencyRepository,
    erasureInspectRepository: createClientErasureInspectRepository(),
    erasureWriteRepository: createClientErasureWriteRepository(),
    erasureDeleteRepository: createClientErasureDeleteRepository(),
    userContactRepository: createUserContactRepository(),
    passwordTokenRepository: createPasswordTokenRepository(),
    emailVerificationRepository: createEmailVerificationRepository(),
    emailChangeRepository: createEmailChangeRepository(),
    mandateLookup: createMandatesRepository(),
    config: { idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs },
  })

  registerAdminFundReceiptRoutes(application, {
    webAuth,
    unitOfWork,
    database,
    clock,
    config: { cursorKey: serverConfig.cursorKey, idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs },
    acknowledgementRepository: fundReceiptAcknowledgementRepository,
    paymentsRepository,
    settlementRepository,
    refundRepository,
    paymentGateway,
    auditRepository,
    idempotencyRepository,
    notificationRepository,
  })
}
