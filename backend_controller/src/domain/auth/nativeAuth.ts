/**
 * Native authentication commands (spec 04 §3.3, 03 §5-§6): activation, native
 * login (with same-device session replacement), and logout. Refresh rotation is
 * a separate command. All raw secrets exist only in memory / the response;
 * PostgreSQL stores only hashes.
 */
import { createHash } from "node:crypto"

import type { FastifyRequest } from "fastify"
import type { Kysely } from "kysely"

import type { AccessTokenService } from "../../auth/accessToken.js"
import type { BreachChecker } from "../../auth/breachCheck.js"
import { hashPassword, verifyDummyPassword, verifyPassword } from "../../auth/passwordHasher.js"
import { maskPhone } from "../../auth/phone.js"
import { generateInitialRefreshToken, hashToken } from "../../auth/refreshDerivation.js"
import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction, User, UserId } from "../../db/repositories.js"
import type { Database } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ActivationInviteWriteRepository } from "../../repositories/activationInviteRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { AuthSessionWriteRepository } from "../../repositories/authSessionRepository.js"
import type { CredentialWriteRepository } from "../../repositories/credentialRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"

const ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000
const REFRESH_IDLE_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000

export interface DeviceInput {
  readonly installationId: string
  readonly name: string
  readonly platform: "android"
  readonly appVersion: string
}

export interface NativeUser {
  readonly userId: string
  readonly fullName: string
  readonly email: string
  readonly phoneMasked: string
  readonly accountStatus: "active"
}

export interface NativeSessionResult {
  readonly user: NativeUser
  readonly accessToken: string
  readonly accessTokenExpiresAt: string
  readonly refreshToken: string
  readonly refreshTokenExpiresAt: string
  readonly sessionId: string
}

export interface NativeAuthDeps {
  readonly userRepository: UserWriteRepository
  readonly activationInviteRepository: ActivationInviteWriteRepository
  readonly credentialRepository: CredentialWriteRepository
  readonly authSessionRepository: AuthSessionWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly breachChecker: BreachChecker
  readonly accessTokenService: AccessTokenService
  readonly database: Kysely<Database>
  readonly refreshKeyVersion: string
  readonly clock: () => Date
}

const deviceIdHash = (installationId: string): Buffer =>
  createHash("sha256").update(installationId).digest()

const buildNativeUser = (user: User): NativeUser => ({
  userId: user.id,
  fullName: user.full_name,
  email: user.email_normalized,
  phoneMasked: maskPhone(user.phone_e164),
  accountStatus: "active",
})

const issueNativeSession = async (
  tx: Transaction,
  deps: NativeAuthDeps,
  user: User,
  device: Buffer,
  now: Date,
): Promise<NativeSessionResult> => {
  const refreshRaw = generateInitialRefreshToken()
  const created = await deps.authSessionRepository.createNativeSession(tx, {
    userId: user.id as UserId,
    deviceIdHash: device,
    refreshTokenHash: hashToken(refreshRaw),
    refreshKeyVersion: deps.refreshKeyVersion,
    sessionExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
  })
  const accessToken = await deps.accessTokenService.sign({ sub: user.id, sid: created.session.id })
  return {
    user: buildNativeUser(user),
    accessToken,
    accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
    refreshToken: refreshRaw,
    refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_IDLE_MS).toISOString(),
    sessionId: created.session.id,
  }
}

export interface ActivateUserInput {
  readonly token: string
  readonly password: string
  readonly device: DeviceInput
  readonly requestId: string
}

export const activateUser = async (
  tx: Transaction,
  deps: NativeAuthDeps,
  input: ActivateUserInput,
): Promise<NativeSessionResult> => {
  const invite = await deps.activationInviteRepository.lockByTokenHash(tx, deps.crypto.hashToken(input.token).hash)
  if (invite === null) throw new AppError("TOKEN_INVALID")
  if (invite.state !== "pending") throw new AppError("TOKEN_ALREADY_USED")
  if (new Date(invite.expires_at).getTime() <= deps.clock().getTime()) throw new AppError("TOKEN_EXPIRED")

  const user = await deps.userRepository.lockById(tx, invite.user_id as UserId)
  if (user === null || user.account_state !== "invited") throw new AppError("STATE_CONFLICT")
  if (await deps.credentialRepository.exists(tx, user.id as UserId)) throw new AppError("STATE_CONFLICT")

  await deps.breachChecker.check(input.password)
  const now = deps.clock()
  await deps.credentialRepository.create(tx, user.id as UserId, await hashPassword(input.password))
  await deps.activationInviteRepository.accept(tx, invite.id, now)
  const activated = await deps.userRepository.activate(tx, user.id as UserId, now)

  const result = await issueNativeSession(tx, deps, activated, deviceIdHash(input.device.installationId), now)
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: user.id,
    command: "user.activate",
    entityType: "user",
    entityId: user.id,
    fromState: "invited",
    toState: "active",
    requestId: input.requestId,
    entityVersion: Number(activated.version),
    metadata: {},
  })
  return result
}

export interface NativeLoginInput {
  readonly email: string
  readonly password: string
  readonly device: DeviceInput
  readonly requestId: string
}

export const nativeLogin = async (
  tx: Transaction,
  deps: NativeAuthDeps,
  input: NativeLoginInput,
): Promise<NativeSessionResult> => {
  const found = await deps.userRepository.lockByEmailWithCredential(tx, input.email.toLowerCase())
  const passwordHash = found?.credential?.password_hash ?? null

  // Uniform timing + response for every pre-verification failure.
  if (found === null || passwordHash === null || found.user.account_state !== "active") {
    await verifyDummyPassword(input.password)
    throw new AppError("INVALID_CREDENTIALS")
  }
  if (!(await verifyPassword(passwordHash, input.password))) {
    throw new AppError("INVALID_CREDENTIALS")
  }

  const now = deps.clock()
  const device = deviceIdHash(input.device.installationId)
  const existing = await deps.authSessionRepository.lockActiveNativeByUserAndDevice(tx, {
    userId: found.user.id as UserId,
    deviceIdHash: device,
  })
  if (existing !== null) {
    await deps.authSessionRepository.revokeSessionFamily(tx, {
      sessionId: existing.id,
      reason: "device_reauthenticated",
      now,
    })
  }

  const result = await issueNativeSession(tx, deps, found.user, device, now)
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: found.user.id,
    command: "auth.native_login",
    entityType: "auth_session",
    entityId: result.sessionId,
    requestId: input.requestId,
    entityVersion: 1,
    metadata: {},
  })
  return result
}

/** Resolve and re-check the native bearer principal (spec 04 §4.5). */
export const authenticateNativeRequest = async (
  request: FastifyRequest,
  deps: NativeAuthDeps,
): Promise<{ userId: string; sessionId: string }> => {
  const header = request.headers.authorization
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw new AppError("AUTHENTICATION_REQUIRED")
  }
  const verified = await deps.accessTokenService.verify(header.slice("Bearer ".length))

  const session = await deps.database
    .selectFrom("auth_sessions")
    .select(["id", "user_id", "state", "channel"])
    .where("id", "=", verified.sid)
    .executeTakeFirst()
  if (session === undefined || session.state !== "active" || session.channel !== "native") {
    throw new AppError("SESSION_INVALID")
  }
  const user = await deps.database
    .selectFrom("users")
    .select(["id", "account_state"])
    .where("id", "=", verified.sub)
    .executeTakeFirst()
  if (user === undefined || user.account_state !== "active") {
    throw new AppError("ACCOUNT_NOT_ACTIVE")
  }
  return { userId: verified.sub, sessionId: verified.sid }
}

export const nativeLogout = async (
  tx: Transaction,
  deps: NativeAuthDeps,
  input: Readonly<{ sessionId: string }>,
): Promise<void> => {
  await deps.authSessionRepository.revokeSessionFamily(tx, {
    sessionId: input.sessionId,
    reason: "logout",
    now: deps.clock(),
  })
}
