import { randomBytes } from "node:crypto"

import type { FastifyInstance } from "fastify"

import { createPasswordRecheckLimiter } from "../../src/auth/passwordRecheckLimiter.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerNomineeSurface } from "../../src/runtime/nomineeComposition.js"
import type { PasswordMailStack } from "./passwordMailSupport.js"

export interface NomineeClient {
  readonly id: string
  readonly token: string
}

type AccountState = "active" | "suspended" | "closed"

export const registerNomineeTestSurface = (instance: FastifyInstance, stack: PasswordMailStack, webAuth: WebAuthDeps): void => {
  registerNomineeSurface(instance, {
    accessTokenService: webAuth.accessTokenService,
    database: stack.database,
    clientWeb: { originAllowlist: [] },
    webAuth,
    unitOfWork: stack.unitOfWork,
    clock: stack.clock,
    crypto: stack.crypto,
    auditRepository: stack.auditRepository,
    passwordRecheckLimiter: createPasswordRecheckLimiter(stack.clock),
    userRepository: stack.userRepository,
    credentialRepository: stack.credentialRepository,
    idempotencyRepository: createIdempotencyRepository(),
    notificationRepository: createNotificationRepository(),
    outboxRepository: stack.outboxRepository,
    emailDeliveryRepository: stack.emailDeliveryRepository,
    config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" },
  })
}

export const seedNomineeClient = async (
  stack: PasswordMailStack,
  webAuth: WebAuthDeps,
  state: AccountState = "active",
): Promise<NomineeClient> => {
  const { id } = await stack.seedUser({ password: true, state })
  const session = await stack.first(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) values ($1, 'native', 'rt1', now() + interval '1 day') returning id",
    [id],
  )
  return { id, token: await webAuth.accessTokenService.sign({ sub: id, sid: String(session.id) }) }
}

export const bearer = (client: NomineeClient, key?: string): Readonly<Record<string, string>> => ({
  authorization: `Bearer ${client.token}`,
  ...(key === undefined ? {} : { "idempotency-key": key }),
})
