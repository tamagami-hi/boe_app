import { randomInt } from "node:crypto"

import { bytesEqual } from "../../crypto/primitives.js"
import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type {
  EmailVerificationRecord,
  EmailVerificationRepository,
} from "../../repositories/emailVerificationRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"

export interface EmailVerificationConfig {
  readonly codeTtlMs: number
  readonly maxAttempts: number
  readonly resendCooldownMs: number
}

export interface EmailVerificationDeps {
  readonly emailVerificationRepository: EmailVerificationRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: EmailVerificationConfig
}

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
const CODE_LENGTH = 6

const generateVerificationCode = (): string => {
  let code = ""
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  }
  return code
}

const isVerified = (verification: EmailVerificationRecord): boolean => verification.state === "verified"

export interface RequestEmailVerificationCodeResult {
  readonly alreadyVerified: boolean
  readonly email: string
  readonly rawCode: string | null
  readonly expiresAt: string | null
}

export const requestEmailVerificationCode = async (
  tx: Transaction,
  deps: EmailVerificationDeps,
  input: Readonly<{ userId: string; requestId: string }>,
): Promise<RequestEmailVerificationCodeResult> => {
  const now = deps.clock()
  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")

  const verified = await deps.emailVerificationRepository.findVerifiedByUser(tx, input.userId)
  if (verified !== null && isVerified(verified)) {
    return { alreadyVerified: true, email: user.email_normalized, rawCode: null, expiresAt: null }
  }

  const latest = await deps.emailVerificationRepository.latestCodeCreatedAt(tx, input.userId)
  if (latest !== null && now.getTime() - latest.getTime() < deps.config.resendCooldownMs) {
    throw new AppError("RATE_LIMITED", { retryAfterSeconds: Math.ceil(deps.config.resendCooldownMs / 1000) })
  }

  const verification = await deps.emailVerificationRepository.start(tx, { userId: input.userId, now })
  if (verification === null) throw new AppError("STATE_CONFLICT")
  await deps.emailVerificationRepository.consumeActiveCode(tx, { userId: input.userId, now })
  const rawCode = generateVerificationCode()
  const hashed = deps.crypto.hashToken(rawCode)
  const expiresAt = new Date(now.getTime() + deps.config.codeTtlMs)
  await deps.emailVerificationRepository.createCode(tx, {
    userId: input.userId,
    codeHash: hashed.hash,
    codeKeyVersion: hashed.keyVersion,
    expiresAt,
  })

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "email_verification.code_requested",
    entityType: "user",
    entityId: input.userId,
    toState: "pending",
    requestId: input.requestId,
    entityVersion: Number(verification.version),
    metadata: { method: "email_otp" },
  })

  return { alreadyVerified: false, email: user.email_normalized, rawCode, expiresAt: expiresAt.toISOString() }
}

export type VerifyEmailOutcome =
  | { readonly kind: "verified"; readonly verification: EmailVerificationRecord }
  | { readonly kind: "already_verified"; readonly verification: EmailVerificationRecord }
  | { readonly kind: "no_active_verification" }
  | { readonly kind: "no_code" }
  | { readonly kind: "expired" }
  | { readonly kind: "locked" }
  | { readonly kind: "invalid" }

export const verifyEmail = async (
  tx: Transaction,
  deps: EmailVerificationDeps,
  input: Readonly<{ userId: string; code: string; requestId: string }>,
): Promise<VerifyEmailOutcome> => {
  const now = deps.clock()
  const verified = await deps.emailVerificationRepository.findVerifiedByUser(tx, input.userId)
  if (verified !== null && isVerified(verified)) {
    return { kind: "already_verified", verification: verified }
  }

  const verification = await deps.emailVerificationRepository.findLatestByUser(tx, input.userId)
  if (verification === null || verification.state !== "pending") return { kind: "no_active_verification" }

  const code = await deps.emailVerificationRepository.lockActiveCode(tx, input.userId)
  if (code === null) return { kind: "no_code" }
  if (new Date(code.expiresAt).getTime() <= now.getTime()) return { kind: "expired" }
  if (code.attemptCount >= deps.config.maxAttempts) return { kind: "locked" }

  const presented = deps.crypto.hashToken(input.code).hash
  if (!bytesEqual(presented, Buffer.from(code.codeHash as unknown as Uint8Array))) {
    await deps.emailVerificationRepository.incrementCodeAttempt(tx, code.id)
    return { kind: "invalid" }
  }

  await deps.emailVerificationRepository.consumeCode(tx, { codeId: code.id, now })
  const verifiedRecord = await deps.emailVerificationRepository.markVerified(tx, {
    userId: input.userId,
    now,
  })
  if (verifiedRecord === null) return { kind: "no_active_verification" }

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "email_verification.completed",
    entityType: "user",
    entityId: input.userId,
    fromState: "pending",
    toState: "verified",
    requestId: input.requestId,
    entityVersion: Number(verifiedRecord.version),
    metadata: { method: "email_otp" },
  })
  return { kind: "verified", verification: verifiedRecord }
}
