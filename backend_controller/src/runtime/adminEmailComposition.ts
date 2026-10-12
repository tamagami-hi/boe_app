import type { FastifyInstance } from "fastify"

import type { Cache } from "../cache/cache.js"
import type { CryptoContext } from "../crypto/context.js"
import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import type { ReleaseFeed } from "../release/releaseFeed.js"
import type { AdminContentRepository } from "../repositories/adminContentRepository.js"
import { createAdminEmailMessageRepository } from "../repositories/adminEmailMessageRepository.js"
import { createAppUpdateAnnouncementRepository } from "../repositories/appUpdateAnnouncementRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { EmailDeliveryWriteRepository } from "../repositories/emailDeliveryRepository.js"
import type { EmailSuppressionWriteRepository } from "../repositories/emailSuppressionRepository.js"
import { createEmailTemplateRepository } from "../repositories/emailTemplateRepository.js"
import type { OutboxWriteRepository } from "../repositories/outboxRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"
import { registerAdminAppUpdateAnnouncementRoutes } from "../routes/adminAppUpdateAnnouncementRoutes.js"
import { registerAdminEmailMessageRoutes } from "../routes/adminEmailMessageRoutes.js"
import { registerAdminEmailTemplateRoutes } from "../routes/adminEmailTemplateRoutes.js"

export interface AdminEmailSurfaceDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly userRepository: UserWriteRepository
  readonly emailSuppressionRepository: EmailSuppressionWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly contentRepository: AdminContentRepository
  readonly crypto: CryptoContext
  readonly cache: Cache
  readonly appUpdate: ReleaseFeed
  readonly clock: () => Date
  readonly config: {
    readonly sesConfigurationSet: string
    readonly sendCooldownMs: number
    readonly supportAddress: string | null
    readonly idempotencyTtlMs: number
  }
}

export const registerAdminEmailSurface = (application: FastifyInstance, deps: AdminEmailSurfaceDeps): void => {
  const emailTemplateRepository = createEmailTemplateRepository()
  registerAdminEmailTemplateRoutes(application, {
    ...deps,
    emailTemplateRepository,
    config: { idempotencyTtlMs: deps.config.idempotencyTtlMs },
  })
  registerAdminEmailMessageRoutes(application, {
    ...deps,
    emailTemplateRepository,
    adminEmailMessageRepository: createAdminEmailMessageRepository(),
  })
  registerAdminAppUpdateAnnouncementRoutes(application, {
    ...deps,
    appUpdateAnnouncementRepository: createAppUpdateAnnouncementRepository(),
  })
}
