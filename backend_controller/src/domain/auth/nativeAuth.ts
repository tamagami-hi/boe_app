/**
 * Native authentication commands (spec 04 §3.3, 03 §5-§6): native login (with
 * same-device session replacement) and logout. Refresh rotation is a separate
 * command. All raw secrets exist only in memory / the response; PostgreSQL
 * stores only hashes.
 *
 * Accounts are born active: the admin approval creates the user with the signup
 * password credential, so there is no activation-invite redemption here — the
 * first thing a new investor does in the app is sign in.
 */
import { createHash } from "node:crypto"

import type { FastifyRequest } from "fastify"
import type { Kysely } from "kysely"

import type { AccessTokenService } from "../../auth/accessToken.js"
import { verifyDummyPassword, verifyPassword } from "../../auth/passwordHasher.js"
import { maskPhone } from "../../auth/phone.js"
import { deriveRefreshToken, generateInitialRefreshToken, hashToken } from "../../auth/refreshDerivation.js"
import type { UnitOfWork } from "../../db/database.js"
import type { Transaction, User, UserId } from "../../db/repositories.js"
import type { AuthLoginOutcome, Database } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { AuthSessionWriteRepository } from "../../repositories/authSessionRepository.js"
import type { LoginEventRepository } from "../../repositories/loginEventRepository.js"
import type { UserLoginIdentity, UserWriteRepository } from "../../repositories/userRepository.js"

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
  readonly authSessionRepository: AuthSessionWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly accessTokenService: AccessTokenService
  readonly database: Kysely<Database>
  readonly refreshKey: Buffer
  readonly refreshKeyVersion: string
  readonly clock: () => Date
  /**
   * Concurrent-device policy. Optional so existing callers and tests keep the
   * previous unlimited behaviour unless they opt in.
   *
   * A sideloaded investing app is used from a phone and maybe a tablet; an
   * unbounded number of live sessions on one account is the shape of shared
   * credentials, not of normal use. The cap evicts rather than rejects — see
   * enforceDeviceLimit.
   */
  readonly deviceLimit?: {
    /** Maximum simultaneous active native sessions per user. */
    readonly maxDevices: number
    /** Normalised emails exempt from the cap (the seeded dev/QA client). */
    readonly exemptEmails: readonly string[]
  }
}

const REFRESH_GRACE_MS = 30 * 1000

/**
 * Extra dependencies the login command needs beyond `NativeAuthDeps`.
 *
 * Login owns its own transaction boundary now (see `nativeLogin`), so it takes
 * the `UnitOfWork` rather than a caller-supplied transaction handle, and it needs
 * the sign-in attempt log.
 */
export interface NativeLoginDeps extends NativeAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly loginEventRepository: LoginEventRepository
  /**
   * Failure-path attempt logging is best effort — a sign-in must fail with
   * INVALID_CREDENTIALS even if the log write fails — so a dropped write is
   * reported here rather than swallowed. Success-path logging is inside the
   * session transaction and therefore not best effort.
   */
  readonly logger?: { readonly warn: (object: Record<string, unknown>, message: string) => void }
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
  provenance: LoginProvenance,
): Promise<NativeSessionResult> => {
  const refreshRaw = generateInitialRefreshToken()
  const created = await deps.authSessionRepository.createNativeSession(tx, {
    userId: user.id as UserId,
    deviceIdHash: device,
    refreshTokenHash: hashToken(refreshRaw),
    refreshKeyVersion: deps.refreshKeyVersion,
    sessionExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
    ipAddress: provenance.ipAddress ?? null,
    userAgent: provenance.userAgent ?? null,
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

export interface LoginProvenance {
  /** Caller address, already normalised to something `inet` accepts, or null. */
  readonly ipAddress?: string | null
  /** Caller User-Agent, already bounded and control-character free, or null. */
  readonly userAgent?: string | null
}

export interface NativeLoginInput extends LoginProvenance {
  readonly email: string
  readonly password: string
  readonly device: DeviceInput
  readonly requestId: string
}

/**
 * Make room for one more device by revoking the oldest sessions over the cap.
 *
 * Evicts rather than rejects: signing in on a new phone should work, and it is
 * the *oldest* enrolment that goes. Refusing the login instead would strand a
 * user whose previous device is lost or wiped — they would have no way to sign in
 * and no way to revoke the sessions holding their slots.
 *
 * Runs after the same-device replacement, so `existing` is already revoked and
 * this only counts *other* devices. Returns how many were evicted, for the audit
 * trail — a user who is silently signed out elsewhere should be explicable from
 * the log.
 */
const enforceDeviceLimit = async (
  tx: Transaction,
  deps: NativeAuthDeps,
  user: User,
  now: Date,
): Promise<number> => {
  const policy = deps.deviceLimit
  if (policy === undefined) return 0
  if (policy.maxDevices <= 0) return 0
  if (policy.exemptEmails.includes(user.email_normalized)) return 0

  const active = await deps.authSessionRepository.listActiveNativeForUserOldestFirst(tx, {
    userId: user.id as UserId,
  })
  // The new session is not inserted yet, so room for it means strictly fewer
  // than the cap may remain.
  const overBy = active.length - (policy.maxDevices - 1)
  if (overBy <= 0) return 0

  for (const session of active.slice(0, overBy)) {
    await deps.authSessionRepository.revokeSessionFamily(tx, {
      sessionId: session.id,
      reason: "device_limit_exceeded",
      now,
    })
  }
  return overBy
}

/**
 * Native login.
 *
 * Split into three phases so the expensive part holds nothing:
 *
 *   1. read the account on the pool, with no transaction and no row lock;
 *   2. verify the password (Argon2id, ~19 MiB, tens of milliseconds) while
 *      holding no database connection at all;
 *   3. open a short transaction to re-check the account, then write the session.
 *
 * This used to be one transaction wrapping all three, opened by the route, with
 * `SELECT … FOR UPDATE` on the `users` and `user_credentials` rows taken *before*
 * the verification. That had two costs that showed up as "sign-in is slow and
 * sometimes fails" under simultaneous use:
 *
 *   * every in-flight sign-in occupied one of `DB_POOL_MAX` (default 10)
 *     connections for the whole Argon2 verification, so ten concurrent sign-ins
 *     exhausted the pool and the eleventh waited out `connectionTimeoutMillis`
 *     (3 s) and then failed;
 *   * two sign-ins for the *same* account serialized completely on the row lock,
 *     as did an attacker replaying one address.
 *
 * Login reads those rows and writes neither, so the lock bought exactly one
 * thing at that point: the guarantee that the credential could not change between
 * verification and session issuance. Phase 3 takes the same users-row lock, but
 * only for the handful of primary-key statements and inserts that actually write
 * — it re-reads `account_state` and the stored password hash, rejects if either
 * moved, and serializes concurrent logins for one account so the device cap and
 * the same-device unique index still hold. See `issueLoginSession`.
 *
 * Every outcome, success or failure, is recorded in `auth_login_events`.
 */
export const nativeLogin = async (
  deps: NativeLoginDeps,
  input: NativeLoginInput,
): Promise<NativeSessionResult> => {
  const emailNormalized = input.email.trim().toLowerCase()
  const device = deviceIdHash(input.device.installationId)

  /**
   * Record a failed attempt, then reject.
   *
   * Written on the pool with no transaction: a burst of wrong-password attempts
   * against one address must not serialize on anything. Best effort — the caller
   * gets INVALID_CREDENTIALS regardless — but a dropped write is logged rather
   * than silently lost, because an attempt log that silently does nothing is
   * indistinguishable from an account under no attack.
   */
  const rejectAndRecord = async (outcome: AuthLoginOutcome, userId: string | null): Promise<never> => {
    try {
      await deps.loginEventRepository.record(deps.database, {
        userId,
        emailNormalized,
        channel: "native",
        outcome,
        deviceIdHash: device,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId,
      })
    } catch (error) {
      deps.logger?.warn(
        { requestId: input.requestId, outcome, error: error instanceof Error ? error.message : "unknown" },
        "failed to record a failed sign-in attempt",
      )
    }
    throw new AppError("INVALID_CREDENTIALS")
  }

  // Phase 1: non-locking read on the pool.
  const identity = await deps.userRepository.findLoginIdentityByEmail(deps.database, emailNormalized)

  // Phase 2: verification, off the connection. Every pre-verification failure
  // still pays a dummy Argon2 verification, so an unknown address is not
  // distinguishable by timing from a wrong password, and the response is the same
  // INVALID_CREDENTIALS in all cases — the distinction lives only in the log.
  if (identity === null) {
    await verifyDummyPassword(input.password)
    return rejectAndRecord("unknown_identity", null)
  }
  if (identity.passwordHash === null) {
    await verifyDummyPassword(input.password)
    return rejectAndRecord("invalid_credentials", identity.user.id)
  }
  if (identity.user.account_state !== "active") {
    await verifyDummyPassword(input.password)
    return rejectAndRecord("account_not_active", identity.user.id)
  }
  if (!(await verifyPassword(identity.passwordHash, input.password))) {
    return rejectAndRecord("invalid_credentials", identity.user.id)
  }

  // Phase 3: short transaction. It returns an outcome rather than throwing on
  // rejection, so the failure record is written outside the transaction that
  // would otherwise roll it back.
  const outcome = await deps.unitOfWork.execute(
    async (tx): Promise<IssueOutcome> => issueLoginSession(tx, deps, input, identity, device),
  )
  if (outcome.kind === "rejected") return rejectAndRecord(outcome.outcome, identity.user.id)
  return outcome.result
}

type IssueOutcome =
  | { readonly kind: "issued"; readonly result: NativeSessionResult }
  | { readonly kind: "rejected"; readonly outcome: AuthLoginOutcome }

/**
 * The write half of a login: re-check what phase 2 assumed, replace this device's
 * session, apply the device cap, issue the session, and record both the audit row
 * and the sign-in event.
 *
 * `lockById` takes `FOR UPDATE` on the users row, so concurrent logins for one
 * account serialize here. That is deliberate and is not the pathology this change
 * removed: the lock is now held for three small primary-key statements and the
 * inserts, not across the Argon2id verification. Two things downstream need it,
 * and both were silently broken without it:
 *
 *   * `lockActiveNativeByUserAndDevice` locks rows that exist, so two concurrent
 *     logins from the *same* installationId would both find no active session,
 *     both skip the revocation, and both insert — one then violating
 *     `auth_sessions_active_native_device_uk` and surfacing as INTERNAL_ERROR
 *     rather than replacing the session. The client's new 20 s request deadline
 *     makes that reachable: an abandoned request keeps running server-side while
 *     the user retries.
 *   * `enforceDeviceLimit` counts active sessions under `FOR UPDATE`, which also
 *     locks nothing when there are none, so N simultaneous first logins would each
 *     see a count of zero and collectively overshoot the cap.
 *
 * The credential re-check compares the stored hash with the one just verified, so
 * a password rotated in between cannot yield a session.
 */
const issueLoginSession = async (
  tx: Transaction,
  deps: NativeLoginDeps,
  input: NativeLoginInput,
  verified: UserLoginIdentity,
  device: Buffer,
): Promise<IssueOutcome> => {
  const user = await deps.userRepository.lockById(tx, verified.user.id as UserId)
  if (user === null) return { kind: "rejected", outcome: "invalid_credentials" }
  if (user.account_state !== "active") return { kind: "rejected", outcome: "account_not_active" }

  const currentHash = await deps.userRepository.findPasswordHash(tx, user.id as UserId)
  if (currentHash === null) return { kind: "rejected", outcome: "invalid_credentials" }
  if (currentHash !== verified.passwordHash) return { kind: "rejected", outcome: "password_changed" }

  const now = deps.clock()
  const existing = await deps.authSessionRepository.lockActiveNativeByUserAndDevice(tx, {
    userId: user.id as UserId,
    deviceIdHash: device,
  })
  if (existing !== null) {
    await deps.authSessionRepository.revokeSessionFamily(tx, {
      sessionId: existing.id,
      reason: "device_reauthenticated",
      now,
    })
  }

  // Only other devices count towards the cap; this device's own prior session
  // was just revoked above, so re-signing in never evicts anyone.
  const evictedDevices = await enforceDeviceLimit(tx, deps, user, now)

  const result = await issueNativeSession(tx, deps, user, device, now, input)
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: user.id,
    command: "auth.native_login",
    entityType: "auth_session",
    entityId: result.sessionId,
    requestId: input.requestId,
    entityVersion: 1,
    metadata: evictedDevices > 0 ? { evictedDevices } : {},
  })
  // Inside the transaction on purpose: a successful sign-in missing from the
  // attempt log would make the log useless as a per-user history, so the session
  // and its record commit together or not at all.
  await deps.loginEventRepository.record(tx, {
    userId: user.id,
    emailNormalized: user.email_normalized.toLowerCase(),
    channel: "native",
    outcome: "success",
    sessionId: result.sessionId,
    deviceIdHash: device,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    requestId: input.requestId,
  })
  return { kind: "issued", result }
}

/**
 * Narrow dependency slice needed to resolve a native bearer principal. Any
 * native-authenticated route (client portfolio reads, logout, ...) can depend on
 * just this pair; `NativeAuthDeps` is a structural superset, so existing callers
 * continue to satisfy it.
 */
export interface NativeRequestAuthDeps {
  readonly accessTokenService: AccessTokenService
  readonly database: Kysely<Database>
}

/** Resolve and re-check the native bearer principal (spec 04 §4.5). */
export const authenticateNativeRequest = async (
  request: FastifyRequest,
  deps: NativeRequestAuthDeps,
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

export interface NativeRefreshInput {
  readonly refreshToken: string
  readonly rotationId: string
}

export interface NativeRefreshResult {
  readonly accessToken: string
  readonly accessTokenExpiresAt: string
  readonly refreshToken: string
  readonly refreshTokenExpiresAt: string
  readonly sessionId: string
}

export type NativeRefreshOutcome =
  | { readonly kind: "issued"; readonly result: NativeRefreshResult }
  | { readonly kind: "reuse_revoked" }

const bufferEquals = (a: Buffer, b: Buffer | null): boolean => b !== null && Buffer.from(a).equals(Buffer.from(b))

/**
 * Native refresh rotation (spec 04 §3.3, 03 §5-§6). Consumes generation N and
 * derives generation N+1; a same-rotationId re-presentation of the immediately
 * previous token inside the 30s grace reproduces the successor without a write;
 * any other reuse revokes the family.
 */
export const nativeRefresh = async (
  tx: Transaction,
  deps: NativeAuthDeps,
  input: NativeRefreshInput,
): Promise<NativeRefreshOutcome> => {
  const presentedHash = hashToken(input.refreshToken)
  const locked = await deps.authSessionRepository.lockByRefreshTokenHash(tx, presentedHash)
  // Unknown token or an already-inactive session: nothing to persist, so a throw
  // (which rolls back the empty transaction) is correct.
  if (locked === null) throw new AppError("SESSION_INVALID")

  const { session, refreshToken: presented } = locked
  const now = deps.clock()
  if (session.state !== "active" || new Date(session.expires_at).getTime() <= now.getTime()) {
    throw new AppError("SESSION_INVALID")
  }

  const issue = async (successorRaw: string): Promise<NativeRefreshOutcome> => {
    const accessToken = await deps.accessTokenService.sign({ sub: session.user_id, sid: session.id })
    return {
      kind: "issued",
      result: {
        accessToken,
        accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
        refreshToken: successorRaw,
        refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_IDLE_MS).toISOString(),
        sessionId: session.id,
      },
    }
  }

  // Current token (unused, unrevoked): perform the rotation.
  if (presented.used_at === null && presented.revoked_at === null) {
    const successorGeneration = Number(presented.generation) + 1
    const successorRaw = deriveRefreshToken(deps.refreshKey, session.id, successorGeneration, input.rotationId)
    await deps.authSessionRepository.rotateRefresh(tx, {
      sessionId: session.id,
      userId: session.user_id,
      currentTokenId: presented.id,
      currentTokenHash: Buffer.from(presented.token_hash as unknown as Uint8Array),
      currentKeyVersion: presented.token_key_version,
      successorGeneration,
      successorHash: hashToken(successorRaw),
      refreshKeyVersion: deps.refreshKeyVersion,
      rotationId: input.rotationId,
      previousValidUntil: new Date(now.getTime() + REFRESH_GRACE_MS),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
      now,
    })
    return issue(successorRaw)
  }

  // Previous token within the 30s grace with the identical rotationId: reproduce.
  const previousHash =
    session.previous_refresh_token_hash === null
      ? null
      : Buffer.from(session.previous_refresh_token_hash as unknown as Uint8Array)
  const graceUntil = session.previous_refresh_valid_until
  const withinGrace = graceUntil !== null && new Date(graceUntil).getTime() > now.getTime()
  if (bufferEquals(presentedHash, previousHash) && withinGrace && session.last_rotation_id === input.rotationId) {
    const successorRaw = deriveRefreshToken(deps.refreshKey, session.id, Number(session.generation), input.rotationId)
    return issue(successorRaw)
  }

  // Any other reuse revokes the family. The revocation MUST commit, so we return
  // an outcome (rather than throw, which would roll it back); the route maps it
  // to SESSION_INVALID.
  await deps.authSessionRepository.revokeSessionFamily(tx, { sessionId: session.id, reason: "refresh_reuse", now })
  return { kind: "reuse_revoked" }
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
