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

    registerProviderEventRoutes(application, {
      unitOfWork,
      clock,
      certificateFetcher,
      config: {
        awsRegion: serverConfig.providerEvents.awsRegion,
        topicArn: serverConfig.providerEvents.topicArn,
        providerEventTtlMs: serverConfig.providerEvents.ttlMs,
      },
      emailProviderEventRepository,
      emailDeliveryRepository,
      emailSuppressionRepository,
    })
  }

  return {
    registerRoutes,
    checkReadiness,
    dispose: async () => {
      await pool.end()
    },
  }
}
