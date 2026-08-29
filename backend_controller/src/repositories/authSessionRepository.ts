/**
 * Auth session repository (spec 03 §7, 04 §4.1). Owns bearer and cookie session
 * creation, refresh-hash lookup under a row lock, and family revocation. Only
 * hashes are stored; raw refresh tokens live in native secure storage.
 *
 * Every method that has to distinguish audiences takes the session channel
 * rather than assuming one, because four channels use this table: `native` and
 * `admin_native` (bearer pairs), `web` and `client_web` (cookie sessions).
 */
import type { AuthRefreshToken, AuthSession, Transaction, UserId } from "../db/repositories.js"
import type { BearerSessionChannel, CookieSessionChannel } from "../db/types.js"

export interface CreateBearerSessionInput {
  readonly userId: UserId
  /** `native` for the client APK, `admin_native` for the admin APK. */
  readonly channel: BearerSessionChannel
  readonly deviceIdHash: Buffer
  readonly refreshTokenHash: Buffer
  readonly refreshKeyVersion: string
  readonly sessionExpiresAt: Date
  readonly refreshExpiresAt: Date
  /**
   * Caller provenance. `auth_sessions.ip_address` and `user_agent` have existed
   * since migration 011 but were never written, so a session could not be told
   * apart from any other. Both must already be normalised (see
   * `http/requestProvenance.ts`) — `auth_sessions_user_agent` rejects control
   * characters and over-long values, and failing that CHECK would fail the login.
   */
  readonly ipAddress?: string | null
  readonly userAgent?: string | null
}

export interface CreatedSession {
  readonly session: AuthSession
  readonly refreshToken: AuthRefreshToken
}

export interface RevokeSessionsResult {
  readonly revokedSessionCount: number
  readonly revokedRefreshTokenCount: number
}

export interface RotateRefreshInput {
  readonly sessionId: string
  readonly userId: string
  readonly currentTokenId: string
  readonly currentTokenHash: Buffer
  readonly currentKeyVersion: string
  readonly successorGeneration: number
  readonly successorHash: Buffer
  readonly refreshKeyVersion: string
  readonly rotationId: string
  readonly previousValidUntil: Date
  readonly refreshExpiresAt: Date
  readonly now: Date
}

export interface CreateWebSessionInput {
  readonly userId: UserId
  /** `web` for the admin console, `client_web` for the investor app in a browser. */
  readonly channel: CookieSessionChannel
  readonly refreshTokenHash: Buffer
  readonly refreshKeyVersion: string
  readonly csrfTokenHash: Buffer
  readonly csrfKeyVersion: string
  readonly sessionExpiresAt: Date
  readonly refreshExpiresAt: Date
  readonly csrfExpiresAt: Date
  /** Caller provenance; must already be normalised (`http/requestProvenance.ts`). */
  readonly ipAddress?: string | null
  readonly userAgent?: string | null
}

export interface RotateWebRefreshInput extends RotateRefreshInput {
  readonly currentCsrfHash: Buffer
  readonly currentCsrfKeyVersion: string
  readonly successorCsrfHash: Buffer
  readonly csrfKeyVersion: string
  readonly csrfExpiresAt: Date
}

export interface AuthSessionWriteRepository {
  createBearerSession: (tx: Transaction, input: CreateBearerSessionInput) => Promise<CreatedSession>
  lockByRefreshTokenHash: (tx: Transaction, tokenHash: Buffer) => Promise<CreatedSession | null>
  lockActiveBearerByUserAndDevice: (
    tx: Transaction,
    input: Readonly<{ userId: UserId; channel: BearerSessionChannel; deviceIdHash: Buffer }>,
  ) => Promise<AuthSession | null>
  /**
   * Active bearer sessions for a user on one channel, oldest first, locked for
   * update.
   *
   * Ordered by `created_at` so a device cap evicts the least recently *signed
   * in* device rather than the least recently used one: re-login already
   * replaces a device's session in place, so `created_at` is the age of that
   * device's enrolment. `auth_sessions_user_created_idx` covers the ordering.
   *
   * Scoped to one channel, so the client APK's cap counts client sessions and
   * the admin APK's counts admin sessions. A shared cap would let an operator's
   * admin sign-in evict their investor session, which is a different audience's
   * credential.
   */
  listActiveBearerForUserOldestFirst: (
    tx: Transaction,
    input: Readonly<{ userId: UserId; channel: BearerSessionChannel }>,
  ) => Promise<readonly AuthSession[]>
  lockActiveBySid: (tx: Transaction, sessionId: string) => Promise<AuthSession | null>
  createWebSession: (tx: Transaction, input: CreateWebSessionInput) => Promise<CreatedSession>
  rotateRefresh: (tx: Transaction, input: RotateRefreshInput) => Promise<void>
  rotateWebRefresh: (tx: Transaction, input: RotateWebRefreshInput) => Promise<void>
  rotateWebCsrf: (
    tx: Transaction,
    input: Readonly<{
      sessionId: string
      channel: CookieSessionChannel
      csrfTokenHash: Buffer
      csrfKeyVersion: string
      csrfExpiresAt: Date
      now: Date
    }>,
  ) => Promise<void>
  revokeSessionFamily: (
    tx: Transaction,
    input: Readonly<{ sessionId: string; reason: string; now: Date }>,
  ) => Promise<void>
  revokeAllForUser: (
    tx: Transaction,
    input: Readonly<{ userId: UserId; reason: string; now: Date }>,
  ) => Promise<RevokeSessionsResult>
}

// Shared refresh-row rotation: mark the consumed token used (so the single-
// current-token partial unique index permits the insert), insert the successor,
// then link the predecessor.
const rotateRefreshRows = async (tx: Transaction, input: RotateRefreshInput): Promise<void> => {
  await tx
    .updateTable("auth_refresh_tokens")
    .set({ used_at: input.now })
    .where("id", "=", input.currentTokenId)
    .execute()

  const successor = await tx
    .insertInto("auth_refresh_tokens")
    .values({
      session_id: input.sessionId,
      user_id: input.userId,
      generation: input.successorGeneration,
      token_hash: input.successorHash,
      token_key_version: input.refreshKeyVersion,
      expires_at: input.refreshExpiresAt,
    })
    .returning("id")
    .executeTakeFirstOrThrow()

  await tx
    .updateTable("auth_refresh_tokens")
    .set({ replaced_by_token_id: successor.id })
    .where("id", "=", input.currentTokenId)
    .execute()
}

export const createAuthSessionRepository = (): AuthSessionWriteRepository => ({
  createBearerSession: async (tx, input) => {
    const session = await tx
      .insertInto("auth_sessions")
      .values({
        user_id: input.userId,
        channel: input.channel,
        device_id_hash: input.deviceIdHash,
        refresh_key_version: input.refreshKeyVersion,
        expires_at: input.sessionExpiresAt,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    const refreshToken = await tx
      .insertInto("auth_refresh_tokens")
      .values({
        session_id: session.id,
        user_id: input.userId,
        generation: 0,
        token_hash: input.refreshTokenHash,
        token_key_version: input.refreshKeyVersion,
        expires_at: input.refreshExpiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return { session, refreshToken }
  },

  lockByRefreshTokenHash: async (tx, tokenHash) => {
    const refreshToken = await tx
      .selectFrom("auth_refresh_tokens")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .forUpdate()
      .executeTakeFirst()
    if (refreshToken === undefined) return null

    const session = await tx
      .selectFrom("auth_sessions")
      .selectAll()
      .where("id", "=", refreshToken.session_id)
      .forUpdate()
      .executeTakeFirst()
    if (session === undefined) return null

    return { session, refreshToken }
  },

  lockActiveBearerByUserAndDevice: async (tx, input) => {
    const row = await tx
      .selectFrom("auth_sessions")
      .selectAll()
      .where("user_id", "=", input.userId)
      .where("channel", "=", input.channel)
      .where("state", "=", "active")
      .where("device_id_hash", "=", input.deviceIdHash)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  listActiveBearerForUserOldestFirst: async (tx, input) =>
    tx
      .selectFrom("auth_sessions")
      .selectAll()
      .where("user_id", "=", input.userId)
      .where("channel", "=", input.channel)
      .where("state", "=", "active")
      // Locked so a burst of simultaneous logins cannot each read the same
      // under-limit count and collectively overshoot the cap.
      .forUpdate()
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute(),

  lockActiveBySid: async (tx, sessionId) => {
    const row = await tx
      .selectFrom("auth_sessions")
      .selectAll()
      .where("id", "=", sessionId)
      .where("state", "=", "active")
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  createWebSession: async (tx, input) => {
    const session = await tx
      .insertInto("auth_sessions")
      .values({
        user_id: input.userId,
        channel: input.channel,
        refresh_key_version: input.refreshKeyVersion,
        csrf_token_hash: input.csrfTokenHash,
        csrf_key_version: input.csrfKeyVersion,
        csrf_expires_at: input.csrfExpiresAt,
        expires_at: input.sessionExpiresAt,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    const refreshToken = await tx
      .insertInto("auth_refresh_tokens")
      .values({
        session_id: session.id,
        user_id: input.userId,
        generation: 0,
        token_hash: input.refreshTokenHash,
        token_key_version: input.refreshKeyVersion,
        expires_at: input.refreshExpiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return { session, refreshToken }
  },

  rotateRefresh: async (tx, input) => {
    await rotateRefreshRows(tx, input)
    await tx
      .updateTable("auth_sessions")
      .set({
        generation: input.successorGeneration,
        last_rotation_id: input.rotationId,
        previous_refresh_token_hash: input.currentTokenHash,
        previous_refresh_key_version: input.currentKeyVersion,
        previous_refresh_valid_until: input.previousValidUntil,
        last_seen_at: input.now,
        updated_at: input.now,
      })
      .where("id", "=", input.sessionId)
      .execute()
  },

  rotateWebRefresh: async (tx, input) => {
    await rotateRefreshRows(tx, input)
    await tx
      .updateTable("auth_sessions")
      .set({
        generation: input.successorGeneration,
        last_rotation_id: input.rotationId,
        previous_refresh_token_hash: input.currentTokenHash,
        previous_refresh_key_version: input.currentKeyVersion,
        previous_refresh_valid_until: input.previousValidUntil,
        csrf_token_hash: input.successorCsrfHash,
        csrf_key_version: input.csrfKeyVersion,
        csrf_expires_at: input.csrfExpiresAt,
        csrf_rotated_at: input.now,
        previous_csrf_token_hash: input.currentCsrfHash,
        previous_csrf_key_version: input.currentCsrfKeyVersion,
        previous_csrf_valid_until: input.previousValidUntil,
        last_seen_at: input.now,
        updated_at: input.now,
      })
      .where("id", "=", input.sessionId)
      .execute()
  },

  // CSRF-only re-issue for reload recovery (GET .../csrf): rotate the
  // synchronizer token without touching the refresh chain. The prior CSRF is
  // overwritten (the client had lost it), so it is immediately invalidated. The
  // channel is part of the predicate, so one audience's recovery can never
  // rotate the other's token even if a session id were confused.
  rotateWebCsrf: async (tx, input) => {
    await tx
      .updateTable("auth_sessions")
      .set({
        csrf_token_hash: input.csrfTokenHash,
        csrf_key_version: input.csrfKeyVersion,
        csrf_expires_at: input.csrfExpiresAt,
        csrf_rotated_at: input.now,
        last_seen_at: input.now,
        updated_at: input.now,
      })
      .where("id", "=", input.sessionId)
      .where("state", "=", "active")
      .where("channel", "=", input.channel)
      .execute()
  },

  revokeSessionFamily: async (tx, input) => {
    await tx
      .updateTable("auth_sessions")
      .set({ state: "revoked", revoked_at: input.now, revocation_reason: input.reason })
      .where("id", "=", input.sessionId)
      .where("state", "=", "active")
      .execute()
    await tx
      .updateTable("auth_refresh_tokens")
      .set({ revoked_at: input.now })
      .where("session_id", "=", input.sessionId)
      .where("used_at", "is", null)
      .where("revoked_at", "is", null)
      .execute()
  },

  revokeAllForUser: async (tx, input) => {
    const sessions = await tx
      .updateTable("auth_sessions")
      .set({ state: "revoked", revoked_at: input.now, revocation_reason: input.reason })
      .where("user_id", "=", input.userId)
      .where("state", "=", "active")
      .executeTakeFirst()

    const refreshTokens = await tx
      .updateTable("auth_refresh_tokens")
      .set({ revoked_at: input.now })
      .where("user_id", "=", input.userId)
      .where("used_at", "is", null)
      .where("revoked_at", "is", null)
      .executeTakeFirst()

    return {
      revokedSessionCount: Number(sessions.numUpdatedRows),
      revokedRefreshTokenCount: Number(refreshTokens.numUpdatedRows),
    }
  },
})
