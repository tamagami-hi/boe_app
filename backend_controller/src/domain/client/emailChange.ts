import { verifyDummyPassword, verifyPassword } from "../../auth/passwordHasher.js"
import { bytesEqual } from "../../crypto/primitives.js"
import type { Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ApplicationWriteRepository } from "../../repositories/applicationRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { AuthSessionWriteRepository } from "../../repositories/authSessionRepository.js"
import type { CredentialWriteRepository } from "../../repositories/credentialRepository.js"
import type { EmailChangeRepository, EmailChangeRequest } from "../../repositories/emailChangeRepository.js"
import type { EmailVerificationRepository } from "../../repositories/emailVerificationRepository.js"
import type { IdentityLockRepository } from "../../repositories/identityLockRepository.js"
import type { PasswordTokenRepository } from "../../repositories/passwordTokenRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { enqueueEmail, type EnqueueEmailDeps } from "../email/enqueueEmail.js"
import { generateVerificationCode } from "./emailVerification.js"

const TEMPLATE_VERSION = "v1"

export interface EmailChangeConfig {
  readonly codeTtlMs: number
  readonly maxAttempts: number
  readonly resendCooldownMs: number
  readonly sesConfigurationSet: string
}

export interface EmailChangeDeps extends EnqueueEmailDeps {
  readonly userRepository: UserWriteRepository
  readonly credentialRepository: CredentialWriteRepository
  readonly emailChangeRepository: EmailChangeRepository
  readonly emailVerificationRepository: Pick<EmailVerificationRepository, "consumeActiveCode">
  readonly passwordTokenRepository: Pick<PasswordTokenRepository, "consumeActive">
  readonly authSessionRepository: Pick<AuthSessionWriteRepository, "revokeAllForUser">
  readonly applicationRepository: Pick<ApplicationWriteRepository, "findContactOwner">
  readonly identityLockRepository: IdentityLockRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
  readonly config: EmailChangeConfig
}

export type RequestEmailChangeOutcome =
  | { readonly kind: "requested"; readonly maskedEmail: string; readonly expiresAt: Date }
  | { readonly kind: "unchanged" }
  | { readonly kind: "incorrect_password" }
  | { readonly kind: "email_taken" }

export type ConfirmEmailChangeOutcome =
  | { readonly kind: "changed"; readonly email: string }
  | { readonly kind: "no_request" }
  | { readonly kind: "expired" }
  | { readonly kind: "locked" }
  | { readonly kind: "invalid" }
  | { readonly kind: "stale" }
  | { readonly kind: "email_taken" }

export interface PendingEmailChange {
  readonly maskedEmail: string
  readonly expiresAt: Date
}

const passwordMatches = async (
  tx: Transaction,
  deps: EmailChangeDeps,
  userId: UserId,
  candidate: string,
): Promise<string | null> => {
  const credential = await deps.credentialRepository.lockByUserId(tx, userId)
  const storedHash = await deps.userRepository.findPasswordHash(tx, userId)
  if (storedHash === null || credential === null) {
    await verifyDummyPassword(candidate)
    return null
  }
  return (await verifyPassword(storedHash, candidate)) ? credential.version : null
}

const targetOf = (deps: EmailChangeDeps, request: EmailChangeRequest): string =>
  deps.crypto.decryptRecipient(request.targetCiphertext, request.targetNonce)

export const readPendingEmailChange = async (
  tx: Transaction,
  deps: Pick<EmailChangeDeps, "emailChangeRepository" | "crypto" | "clock">,
  userId: string,
): Promise<PendingEmailChange | null> => {
  const request = await deps.emailChangeRepository.findActive(tx, userId)
  if (request === null || request.expiresAt.getTime() <= deps.clock().getTime()) return null
  return {
    maskedEmail: deps.crypto.maskEmail(deps.crypto.decryptRecipient(request.targetCiphertext, request.targetNonce)),
    expiresAt: request.expiresAt,
  }
}

export const requestEmailChange = async (
  tx: Transaction,
  deps: EmailChangeDeps,
  input: Readonly<{ userId: string; newEmail: string; currentPassword: string; requestId: string }>,
): Promise<RequestEmailChangeOutcome> => {
  const userId = input.userId as UserId
  const now = deps.clock()
  await deps.identityLockRepository.lockIdentities(tx, { emailNormalized: input.newEmail })
  const user = await deps.userRepository.lockById(tx, userId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (user.account_state !== "active") throw new AppError("ACCOUNT_NOT_ACTIVE")

  const credentialVersion = await passwordMatches(tx, deps, userId, input.currentPassword)
  if (credentialVersion === null) return { kind: "incorrect_password" }
  if (user.email_normalized === input.newEmail) return { kind: "unchanged" }

  const owner = await deps.applicationRepository.findContactOwner(tx, {
    emailNormalized: input.newEmail,
    excludeUserId: input.userId,
  })
  if (owner !== null) return { kind: "email_taken" }

  const latest = await deps.emailChangeRepository.latestCreatedAt(tx, input.userId)
  if (latest !== null && now.getTime() - latest.getTime() < deps.config.resendCooldownMs) {
    throw new AppError("RATE_LIMITED", {
      retryAfterSeconds: Math.ceil((latest.getTime() + deps.config.resendCooldownMs - now.getTime()) / 1000),
    })
  }

  await deps.emailChangeRepository.retireActive(tx, { userId: input.userId, now })
  const code = generateVerificationCode()
  const hashed = deps.crypto.hashToken(code)
  const target = deps.crypto.encryptRecipient(input.newEmail)
  const expiresAt = new Date(now.getTime() + deps.config.codeTtlMs)
  const request = await deps.emailChangeRepository.create(tx, {
    userId: input.userId,
    targetCiphertext: target.ciphertext,
    targetNonce: target.nonce,
    targetKeyVersion: target.keyVersion,
    codeHash: hashed.hash,
    codeKeyVersion: hashed.keyVersion,
    boundEmailRevision: user.email_revision,
    boundCredentialVersion: credentialVersion,
    expiresAt,
  })

  await enqueueEmail(tx, deps, {
    recipient: input.newEmail,
    template: { templateKey: "email_change_code", userId: input.userId },
    templateVersion: TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "user.email_change_code",
    eventVersion: 1,
    aggregateType: "user",
    aggregateId: input.userId,
    requestId: input.requestId,
    deduplicationKey: `email_change_code:${request.id}`,
    payload: { template: "email_change_code", emailChangeRequestId: request.id, validForMs: deps.config.codeTtlMs },
    sealedPayload: { code },
  })

  const maskedEmail = deps.crypto.maskEmail(input.newEmail)
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "user.email_change_requested",
    entityType: "user",
    entityId: input.userId,
    requestId: input.requestId,
    entityVersion: Number(user.version),
    metadata: { target: maskedEmail },
  })

  return { kind: "requested", maskedEmail, expiresAt }
}

const queueChangeNotice = async (
  tx: Transaction,
  deps: EmailChangeDeps,
  input: Readonly<{ userId: string; recipient: string; role: "previous" | "current"; newMasked: string; version: string; requestId: string }>,
): Promise<void> => {
  await enqueueEmail(tx, deps, {
    recipient: input.recipient,
    template: { templateKey: "contact_email_changed", userId: input.userId },
    templateVersion: TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "user.email_changed",
    eventVersion: 1,
    aggregateType: "user",
    aggregateId: input.userId,
    requestId: input.requestId,
    deduplicationKey: `contact_email_changed:${input.userId}:${input.version}:${input.role}`,
    payload: { template: "contact_email_changed", role: input.role, newEmail: input.newMasked },
  })
}

export const confirmEmailChange = async (
  tx: Transaction,
  deps: EmailChangeDeps,
  input: Readonly<{ userId: string; code: string; requestId: string }>,
): Promise<ConfirmEmailChangeOutcome> => {
  const userId = input.userId as UserId
  const now = deps.clock()
  const pending = await deps.emailChangeRepository.findActive(tx, input.userId)
  if (pending === null) return { kind: "no_request" }
  const target = targetOf(deps, pending)
  await deps.identityLockRepository.lockIdentities(tx, { emailNormalized: target })

  const user = await deps.userRepository.lockById(tx, userId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (user.account_state !== "active") throw new AppError("ACCOUNT_NOT_ACTIVE")
  const credential = await deps.credentialRepository.lockByUserId(tx, userId)
  const request = await deps.emailChangeRepository.lockActive(tx, input.userId)
  if (request === null || request.id !== pending.id) return { kind: "no_request" }
  if (request.expiresAt.getTime() <= now.getTime()) return { kind: "expired" }
  if (request.attemptCount >= deps.config.maxAttempts) return { kind: "locked" }

  if (!bytesEqual(deps.crypto.hashToken(input.code).hash, request.codeHash)) {
    await deps.emailChangeRepository.incrementAttempt(tx, request.id)
    return { kind: "invalid" }
  }

  if (request.boundEmailRevision !== user.email_revision || request.boundCredentialVersion !== (credential?.version ?? "0")) {
    await deps.emailChangeRepository.consume(tx, { requestId: request.id, now })
    return { kind: "stale" }
  }

  const owner = await deps.applicationRepository.findContactOwner(tx, { emailNormalized: target, excludeUserId: input.userId })
  if (owner !== null) {
    await deps.emailChangeRepository.consume(tx, { requestId: request.id, now })
    return { kind: "email_taken" }
  }

  const updated = await deps.userRepository.replaceEmail(tx, {
    userId,
    emailNormalized: target,
    expectedVersion: user.version,
    now,
  })
  if (updated === null) throw new AppError("STATE_CONFLICT")

  await deps.emailChangeRepository.consume(tx, { requestId: request.id, now })
  await deps.emailVerificationRepository.consumeActiveCode(tx, { userId: input.userId, now })
  await deps.passwordTokenRepository.consumeActive(tx, { userId: input.userId, now })
  await deps.authSessionRepository.revokeAllForUser(tx, { userId, reason: "email_changed", now })

  const previousMasked = deps.crypto.maskEmail(user.email_normalized)
  const newMasked = deps.crypto.maskEmail(target)
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "user.email_changed",
    entityType: "user",
    entityId: input.userId,
    requestId: input.requestId,
    entityVersion: Number(updated.version),
    metadata: { previous: previousMasked, current: newMasked },
  })
  const notice = { userId: input.userId, newMasked, version: updated.version, requestId: input.requestId }
  await queueChangeNotice(tx, deps, { ...notice, recipient: user.email_normalized, role: "previous" })
  await queueChangeNotice(tx, deps, { ...notice, recipient: target, role: "current" })

  return { kind: "changed", email: target }
}
