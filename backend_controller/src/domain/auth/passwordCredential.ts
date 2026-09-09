import { bytesEqual } from "../../crypto/primitives.js"
import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction, UserId } from "../../db/repositories.js"
import type { PasswordTokenPurpose } from "../../db/types.js"
import { hashPassword, verifyDummyPassword, verifyPassword } from "../../auth/passwordHasher.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { AuthSessionWriteRepository } from "../../repositories/authSessionRepository.js"
import type { CredentialWriteRepository } from "../../repositories/credentialRepository.js"
import type { PasswordTokenRepository } from "../../repositories/passwordTokenRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"

export interface PasswordCredentialConfig {
  readonly tokenTtlMs: number
  readonly maxAttempts: number
  readonly requestCooldownMs: number
}

export interface PasswordCredentialDeps {
  readonly passwordTokenRepository: PasswordTokenRepository
  readonly credentialRepository: CredentialWriteRepository
  readonly authSessionRepository: AuthSessionWriteRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: PasswordCredentialConfig
}

export interface IssuedPasswordToken {
  readonly userId: string
  readonly email: string
  readonly rawToken: string
  readonly expiresAt: Date
  readonly purpose: PasswordTokenPurpose
}

const REVOCATION_REASONS: Readonly<Record<PasswordTokenPurpose | "change", string>> = {
  set: "password_set",
  reset: "password_reset",
  change: "password_changed",
}

const AUDIT_COMMANDS: Readonly<Record<PasswordTokenPurpose | "change", string>> = {
  set: "password.set_by_invite",
  reset: "password.reset_completed",
  change: "password.changed",
}

export const issuePasswordToken = async (
  tx: Transaction,
  deps: PasswordCredentialDeps,
  input: Readonly<{ userId: string; purpose: PasswordTokenPurpose; requestId: string }>,
): Promise<IssuedPasswordToken> => {
  const now = deps.clock()
  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")

  const latest = await deps.passwordTokenRepository.latestCreatedAt(tx, input.userId)
  if (latest !== null && now.getTime() - latest.getTime() < deps.config.requestCooldownMs) {
    throw new AppError("RATE_LIMITED", {
      retryAfterSeconds: Math.ceil(deps.config.requestCooldownMs / 1000),
    })
  }

  await deps.passwordTokenRepository.consumeActive(tx, { userId: input.userId, now })

  const minted = deps.crypto.generateVerificationToken()
  const expiresAt = new Date(now.getTime() + deps.config.tokenTtlMs)
  await deps.passwordTokenRepository.create(tx, {
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: minted.hash,
    tokenKeyVersion: minted.keyVersion,
    expiresAt,
  })

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: input.purpose === "set" ? "password.set_requested" : "password.reset_requested",
    entityType: "user",
    entityId: input.userId,
    requestId: input.requestId,
    entityVersion: Number(user.version),
    metadata: { purpose: input.purpose },
  })

  return {
    userId: input.userId,
    email: user.email_normalized,
    rawToken: minted.token,
    expiresAt,
    purpose: input.purpose,
  }
}

export type RedeemPasswordTokenOutcome =
  | { readonly kind: "redeemed"; readonly userId: string; readonly purpose: PasswordTokenPurpose }
  | { readonly kind: "unknown_token" }
  | { readonly kind: "expired" }
  | { readonly kind: "locked" }

export const redeemPasswordToken = async (
  tx: Transaction,
  deps: PasswordCredentialDeps,
  input: Readonly<{ rawToken: string; newPassword: string; requestId: string }>,
): Promise<RedeemPasswordTokenOutcome> => {
  const now = deps.clock()
  const presented = deps.crypto.hashToken(input.rawToken)
  const token = await deps.passwordTokenRepository.lockActiveByHash(tx, presented.hash)
  if (token === null) return { kind: "unknown_token" }

  if (token.expiresAt.getTime() <= now.getTime()) return { kind: "expired" }
  if (token.attemptCount >= deps.config.maxAttempts) return { kind: "locked" }
  if (!bytesEqual(presented.hash, Buffer.from(token.tokenHash as unknown as Uint8Array))) {
    await deps.passwordTokenRepository.incrementAttempt(tx, token.id)
    return { kind: "unknown_token" }
  }

  const user = await deps.userRepository.lockById(tx, token.userId as UserId)
  if (user === null) return { kind: "unknown_token" }

  if (!(await deps.passwordTokenRepository.consume(tx, { tokenId: token.id, now }))) {
    return { kind: "unknown_token" }
  }

  await applyNewPassword(tx, deps, {
    userId: token.userId,
    newPassword: input.newPassword,
    userVersion: user.version,
    flow: token.purpose,
    requestId: input.requestId,
  })

  return { kind: "redeemed", userId: token.userId, purpose: token.purpose }
}

export type ChangePasswordOutcome =
  | { readonly kind: "changed" }
  | { readonly kind: "no_credential" }
  | { readonly kind: "incorrect_password" }

export const changePassword = async (
  tx: Transaction,
  deps: PasswordCredentialDeps,
  input: Readonly<{
    userId: string
    currentPassword: string
    newPassword: string
    requestId: string
  }>,
): Promise<ChangePasswordOutcome> => {
  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) return { kind: "no_credential" }

  const storedHash = await deps.userRepository.findPasswordHash(tx, input.userId as UserId)
  if (storedHash === null) {
    await verifyDummyPassword(input.currentPassword)
    return { kind: "no_credential" }
  }
  if (!(await verifyPassword(storedHash, input.currentPassword))) {
    return { kind: "incorrect_password" }
  }

  await applyNewPassword(tx, deps, {
    userId: input.userId,
    newPassword: input.newPassword,
    userVersion: user.version,
    flow: "change",
    requestId: input.requestId,
  })

  return { kind: "changed" }
}

const applyNewPassword = async (
  tx: Transaction,
  deps: PasswordCredentialDeps,
  input: Readonly<{
    userId: string
    newPassword: string
    userVersion: string
    flow: PasswordTokenPurpose | "change"
    requestId: string
  }>,
): Promise<void> => {
  const now = deps.clock()
  const argon2idHash = await hashPassword(input.newPassword)
  await deps.credentialRepository.replace(tx, {
    userId: input.userId as UserId,
    argon2idHash,
    now,
  })

  const revoked = await deps.authSessionRepository.revokeAllForUser(tx, {
    userId: input.userId as UserId,
    reason: REVOCATION_REASONS[input.flow],
    now,
  })

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: AUDIT_COMMANDS[input.flow],
    entityType: "user",
    entityId: input.userId,
    requestId: input.requestId,
    entityVersion: Number(input.userVersion),
    metadata: {
      flow: input.flow,
      revokedSessionCount: revoked.revokedSessionCount,
      revokedRefreshTokenCount: revoked.revokedRefreshTokenCount,
    },
  })
}
