import type { Kysely } from "kysely"

import { verifyDummyPassword, verifyPassword } from "../../auth/passwordHasher.js"
import type { CryptoContext } from "../../crypto/context.js"
import type { UnitOfWork } from "../../db/database.js"
import type { Transaction, UserId } from "../../db/repositories.js"
import type { Database } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AdminStepUpRepository } from "../../repositories/adminStepUpRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"

export const APP_CONFIG_PUBLISH_ACTION = "app_config.publish"
export type AdminStepUpAction = typeof APP_CONFIG_PUBLISH_ACTION

export const ADMIN_STEP_UP_TTL_MS = 5 * 60_000

const WRONG_PASSWORD_MESSAGE = "That password is not right."
const CONFIRMATION_INVALID_MESSAGE =
  "This password confirmation does not belong to this session. Enter your password again to publish."
const CONFIRMATION_USED_MESSAGE =
  "This password confirmation was already used. Enter your password again to publish."
const CONFIRMATION_EXPIRED_MESSAGE =
  "This password confirmation expired. Enter your password again to publish."

export interface AdminStepUpPrincipal {
  readonly userId: string
  readonly sessionId: string
}

export interface ConfirmAdminPasswordDeps {
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly userRepository: Pick<UserWriteRepository, "findPasswordHash">
  readonly stepUpRepository: AdminStepUpRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: Pick<CryptoContext, "generateVerificationToken">
  readonly clock: () => Date
  readonly logger: { readonly warn: (object: Record<string, unknown>, message: string) => void }
}

export interface ConfirmAdminPasswordInput {
  readonly principal: AdminStepUpPrincipal
  readonly password: string
  readonly action: AdminStepUpAction
  readonly requestId: string
}

export interface IssuedAdminStepUp {
  readonly confirmation: string
  readonly action: AdminStepUpAction
  readonly expiresAt: Date
}

const recordRefusal = async (deps: ConfirmAdminPasswordDeps, input: ConfirmAdminPasswordInput): Promise<never> => {
  try {
    await deps.unitOfWork.execute((tx) =>
      deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: input.principal.userId,
        command: "auth.step_up_refused",
        entityType: "user",
        entityId: input.principal.userId,
        requestId: input.requestId,
        entityVersion: 1,
        metadata: { action: input.action, sessionId: input.principal.sessionId, outcome: "invalid_credentials" },
      }),
    )
  } catch (error) {
    deps.logger.warn(
      { requestId: input.requestId, error: error instanceof Error ? error.message : "unknown" },
      "failed to record a refused admin password confirmation",
    )
  }
  throw new AppError("INVALID_CREDENTIALS", { message: WRONG_PASSWORD_MESSAGE })
}

const issueStepUp = async (
  tx: Transaction,
  deps: ConfirmAdminPasswordDeps,
  input: ConfirmAdminPasswordInput,
  verifiedHash: string,
): Promise<IssuedAdminStepUp | null> => {
  const currentHash = await deps.userRepository.findPasswordHash(tx, input.principal.userId as UserId)
  if (currentHash !== verifiedHash) return null

  const now = deps.clock()
  const minted = deps.crypto.generateVerificationToken()
  const expiresAt = new Date(now.getTime() + ADMIN_STEP_UP_TTL_MS)
  const stepUpId = await deps.stepUpRepository.issue(tx, {
    userId: input.principal.userId,
    sessionId: input.principal.sessionId,
    action: input.action,
    tokenHash: minted.hash,
    tokenKeyVersion: minted.keyVersion,
    expiresAt,
    now,
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.principal.userId,
    command: "auth.step_up_confirmed",
    entityType: "admin_step_up_confirmation",
    entityId: stepUpId,
    requestId: input.requestId,
    entityVersion: 1,
    metadata: { action: input.action, sessionId: input.principal.sessionId },
  })
  return { confirmation: minted.token, action: input.action, expiresAt }
}

export const confirmAdminPassword = async (
  deps: ConfirmAdminPasswordDeps,
  input: ConfirmAdminPasswordInput,
): Promise<IssuedAdminStepUp> => {
  const storedHash = await deps.userRepository.findPasswordHash(deps.database, input.principal.userId as UserId)
  if (storedHash === null) {
    await verifyDummyPassword(input.password)
    return recordRefusal(deps, input)
  }
  if (!(await verifyPassword(storedHash, input.password))) return recordRefusal(deps, input)

  const issued = await deps.unitOfWork.execute((tx) => issueStepUp(tx, deps, input, storedHash))
  return issued ?? recordRefusal(deps, input)
}

export interface ConsumeAdminStepUpDeps {
  readonly stepUpRepository: AdminStepUpRepository
  readonly crypto: Pick<CryptoContext, "hashToken">
}

export interface ConsumeAdminStepUpInput {
  readonly principal: AdminStepUpPrincipal
  readonly action: AdminStepUpAction
  readonly presented: string
  readonly now: Date
}

export const consumeAdminStepUp = async (
  tx: Transaction,
  deps: ConsumeAdminStepUpDeps,
  input: ConsumeAdminStepUpInput,
): Promise<string> => {
  const presented = {
    userId: input.principal.userId,
    sessionId: input.principal.sessionId,
    action: input.action,
    tokenHash: deps.crypto.hashToken(input.presented).hash,
  }
  const consumed = await deps.stepUpRepository.consume(tx, { ...presented, now: input.now })
  if (consumed !== null) return consumed

  const bound = await deps.stepUpRepository.findBound(tx, presented)
  if (bound === null) throw new AppError("TOKEN_INVALID", { message: CONFIRMATION_INVALID_MESSAGE })
  if (bound.consumedAt !== null) throw new AppError("TOKEN_ALREADY_USED", { message: CONFIRMATION_USED_MESSAGE })
  throw new AppError("TOKEN_EXPIRED", { message: CONFIRMATION_EXPIRED_MESSAGE })
}
