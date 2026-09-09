import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { PasswordTokenPurpose } from "../db/types.js"

export interface PasswordCredentialToken {
  readonly id: string
  readonly userId: string
  readonly purpose: PasswordTokenPurpose
  readonly tokenHash: Buffer
  readonly tokenKeyVersion: string
  readonly attemptCount: number
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly createdAt: Date
}

export interface CreatePasswordTokenInput {
  readonly userId: string
  readonly purpose: PasswordTokenPurpose
  readonly tokenHash: Buffer
  readonly tokenKeyVersion: string
  readonly expiresAt: Date
}

export interface PasswordTokenRepository {
  create: (tx: Transaction, input: CreatePasswordTokenInput) => Promise<PasswordCredentialToken>
  lockActive: (tx: Transaction, userId: string) => Promise<PasswordCredentialToken | null>
  lockActiveByHash: (tx: Transaction, tokenHash: Buffer) => Promise<PasswordCredentialToken | null>
  latestCreatedAt: (tx: Transaction, userId: string) => Promise<Date | null>
  consumeActive: (tx: Transaction, input: Readonly<{ userId: string; now: Date }>) => Promise<void>
  consume: (tx: Transaction, input: Readonly<{ tokenId: string; now: Date }>) => Promise<boolean>
  incrementAttempt: (tx: Transaction, tokenId: string) => Promise<void>
}

const mapToken = (row: {
  readonly id: string
  readonly user_id: string
  readonly purpose: PasswordTokenPurpose
  readonly token_hash: Buffer
  readonly token_key_version: string
  readonly attempt_count: number
  readonly expires_at: Date
  readonly consumed_at: Date | null
  readonly created_at: Date
}): PasswordCredentialToken => ({
  id: row.id,
  userId: row.user_id,
  purpose: row.purpose,
  tokenHash: row.token_hash,
  tokenKeyVersion: row.token_key_version,
  attemptCount: row.attempt_count,
  expiresAt: row.expires_at,
  consumedAt: row.consumed_at,
  createdAt: row.created_at,
})

export const createPasswordTokenRepository = (): PasswordTokenRepository => ({
  create: async (tx, input) => {
    const row = await tx
      .insertInto("password_credential_tokens")
      .values({
        user_id: input.userId,
        purpose: input.purpose,
        token_hash: input.tokenHash,
        token_key_version: input.tokenKeyVersion,
        expires_at: input.expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapToken(row)
  },

  lockActive: async (tx, userId) => {
    const row = await tx
      .selectFrom("password_credential_tokens")
      .selectAll()
      .where("user_id", "=", userId)
      .where("consumed_at", "is", null)
      .forUpdate()
      .executeTakeFirst()
    return row === undefined ? null : mapToken(row)
  },

  lockActiveByHash: async (tx, tokenHash) => {
    const row = await tx
      .selectFrom("password_credential_tokens")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .where("consumed_at", "is", null)
      .forUpdate()
      .executeTakeFirst()
    return row === undefined ? null : mapToken(row)
  },

  latestCreatedAt: async (tx, userId) => {
    const row = await tx
      .selectFrom("password_credential_tokens")
      .select("created_at")
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst()
    return row === undefined ? null : new Date(row.created_at)
  },

  consumeActive: async (tx, input) => {
    await tx
      .updateTable("password_credential_tokens")
      .set({ consumed_at: input.now })
      .where("user_id", "=", input.userId)
      .where("consumed_at", "is", null)
      .execute()
  },

  consume: async (tx, input) => {
    const result = await tx
      .updateTable("password_credential_tokens")
      .set({ consumed_at: input.now })
      .where("id", "=", input.tokenId)
      .where("consumed_at", "is", null)
      .executeTakeFirst()
    return Number(result.numUpdatedRows) === 1
  },

  incrementAttempt: async (tx, tokenId) => {
    await tx
      .updateTable("password_credential_tokens")
      .set({ attempt_count: sql<number>`attempt_count + 1` })
      .where("id", "=", tokenId)
      .execute()
  },
})
