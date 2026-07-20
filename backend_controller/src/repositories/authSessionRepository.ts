/**
 * Auth session repository (spec 03 §7, 04 §4.1). Owns native session + refresh
 * token creation, refresh-hash lookup under a row lock, and family revocation.
 * Only hashes are stored; raw refresh tokens live in native secure storage.
 *
 * The web (cookie + CSRF) path and the refresh-rotation state machine
 * (previous-pair 30s grace, family reuse detection) land in BE-010c.
 */
import type { AuthRefreshToken, AuthSession, Transaction, UserId } from "../db/repositories.js"

export interface CreateNativeSessionInput {
  readonly userId: UserId
  readonly deviceIdHash: Buffer
  readonly refreshTokenHash: Buffer
  readonly refreshKeyVersion: string
  readonly sessionExpiresAt: Date
  readonly refreshExpiresAt: Date
}

export interface CreatedSession {
  readonly session: AuthSession
  readonly refreshToken: AuthRefreshToken
}

export interface RevokeSessionsResult {
  readonly revokedSessionCount: number
  readonly revokedRefreshTokenCount: number
}

export interface AuthSessionWriteRepository {
  createNativeSession: (tx: Transaction, input: CreateNativeSessionInput) => Promise<CreatedSession>
  lockByRefreshTokenHash: (tx: Transaction, tokenHash: Buffer) => Promise<CreatedSession | null>
  revokeAllForUser: (
    tx: Transaction,
    input: Readonly<{ userId: UserId; reason: string; now: Date }>,
  ) => Promise<RevokeSessionsResult>
}

export const createAuthSessionRepository = (): AuthSessionWriteRepository => ({
  createNativeSession: async (tx, input) => {
    const session = await tx
      .insertInto("auth_sessions")
      .values({
        user_id: input.userId,
        channel: "native",
        device_id_hash: input.deviceIdHash,
        refresh_key_version: input.refreshKeyVersion,
        expires_at: input.sessionExpiresAt,
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
