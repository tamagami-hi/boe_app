import type { FastifyInstance } from "fastify"

import { createFixedWindowRateLimiter } from "../http/rateLimit.js"
import { createAccountingReportRepository } from "../repositories/accountingReportRepository.js"
import { createAdminCatalogRepository } from "../repositories/adminCatalogRepository.js"
import { createAdminOversightRepository } from "../repositories/adminOversightRepository.js"
import { createAuditTrailRepository } from "../repositories/auditTrailRepository.js"
import { createClientReturnsRepository } from "../repositories/clientReturnsRepository.js"
import { createFundAumRepository } from "../repositories/fundAumRepository.js"
import { createMaturityRepository } from "../repositories/maturityRepository.js"
import { createUserNomineeRepository } from "../repositories/userNomineeRepository.js"
import { registerAdminAuditTrailRoutes } from "../routes/adminAuditTrailRoutes.js"
import { registerAdminAumRoutes } from "../routes/adminAumRoutes.js"
import { registerAdminCatalogRoutes } from "../routes/adminCatalogRoutes.js"
import { registerAdminClientGrowthRoutes, type AdminClientGrowthDeps } from "../routes/adminClientGrowthRoutes.js"
import { registerAdminClientReturnRoutes, type AdminClientReturnDeps } from "../routes/adminClientReturnRoutes.js"
import { registerAdminContentRoutes, type AdminContentDeps } from "../routes/adminContentRoutes.js"
import { registerAdminFundGrowthPreviewRoutes } from "../routes/adminFundGrowthPreviewRoutes.js"
import { registerAdminFundReceiptRoutes, type AdminFundReceiptDeps } from "../routes/adminFundReceiptRoutes.js"
import { registerAdminIdentityRoutes, type AdminIdentityDeps } from "../routes/adminIdentityRoutes.js"
import { registerAdminMaturityRoutes, type AdminMaturityDeps } from "../routes/adminMaturityRoutes.js"
import { registerAdminNomineeRoutes } from "../routes/adminNomineeRoutes.js"
import { registerAdminOversightRoutes, type AdminOversightDeps } from "../routes/adminOversightRoutes.js"
import { registerAdminReportRoutes } from "../routes/adminReportRoutes.js"
import { registerAdminSupportRoutes, type AdminSupportDeps } from "../routes/adminSupportRoutes.js"
import type { ServerConfig } from "./environment.js"
import { registerRecordingSurface, type RecordingSurfaceDeps } from "./recordingComposition.js"

type AdminServerConfig = Pick<ServerConfig, "appUpdate" | "cursorKey" | "fundAum" | "sesConfigurationSet" | "ttls">

export type AdminSurfaceDeps = Omit<AdminIdentityDeps, "config" | "appUpdate"> &
  Omit<AdminContentDeps, "config" | "contentRepository"> &
  Omit<AdminOversightDeps, "config" | "oversightRepository"> &
  Omit<AdminSupportDeps, "config"> &
  Omit<AdminClientGrowthDeps, "config"> &
  Omit<RecordingSurfaceDeps, "config"> &
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

  registerAdminClientGrowthRoutes(application, {
    webAuth,
    unitOfWork,
    database,
    clock,
    config: {
      idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
    },
    clientGrowthRepository,
    auditRepository,
    idempotencyRepository,
    notificationRepository,
  })

  registerRecordingSurface(application, {
    webAuth, accessTokenService, clientWeb, unitOfWork, database, clock, outboxRepository, emailDeliveryRepository, crypto,
    clientPositionRepository, clientGrowthRepository, userRepository, auditRepository, idempotencyRepository, notificationRepository,
    config: {
      idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs,
      cursorKey: serverConfig.cursorKey,
      sesConfigurationSet: serverConfig.sesConfigurationSet,
    },
  })

  registerAdminClientReturnRoutes(application, {
    webAuth, database, clock, config: { cursorKey: serverConfig.cursorKey },
    clientReturnsRepository: createClientReturnsRepository(), clientPositionRepository,
  })

  const readDeps = { webAuth, database, clock, config: { cursorKey: serverConfig.cursorKey } }
  registerAdminReportRoutes(application, { ...readDeps, accountingReportRepository: createAccountingReportRepository() })
  registerAdminAuditTrailRoutes(application, { ...readDeps, auditTrailRepository: createAuditTrailRepository() })

  registerAdminMaturityRoutes(application, {
    webAuth,
    unitOfWork,
    database,
    clock,
    config: { idempotencyTtlMs: serverConfig.ttls.idempotencyTtlMs },
    maturityRepository: createMaturityRepository(),
    clientGrowthRepository,
    auditRepository,
    idempotencyRepository,
    notificationRepository,
  })

  registerAdminNomineeRoutes(application, {
    webAuth, unitOfWork, clock, userRepository, auditRepository, idempotencyRepository,
    userNomineeRepository: createUserNomineeRepository(),
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
