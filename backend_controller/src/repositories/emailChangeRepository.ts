import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export interface EmailChangeRequest {
  readonly id: string
  readonly userId: string
  readonly targetCiphertext: Buffer
  readonly targetNonce: Buffer
  readonly targetKeyVersion: string
  readonly codeHash: Buffer
  readonly codeKeyVersion: string
  readonly boundEmailRevision: string
  readonly boundCredentialVersion: string
  readonly attemptCount: number
  readonly expiresAt: Date
  readonly createdAt: Date
  readonly consumedAt: Date | null
}

export interface CreateEmailChangeInput {
  readonly userId: string
  readonly targetCiphertext: Buffer
  readonly targetNonce: Buffer
  readonly targetKeyVersion: string
  readonly codeHash: Buffer
  readonly codeKeyVersion: string
  readonly boundEmailRevision: string
  readonly boundCredentialVersion: string
  readonly expiresAt: Date
}

export interface EmailChangeRepository {
  create: (tx: Transaction, input: CreateEmailChangeInput) => Promise<EmailChangeRequest>
  findActive: (tx: Transaction, userId: string) => Promise<EmailChangeRequest | null>
  lockActive: (tx: Transaction, userId: string) => Promise<EmailChangeRequest | null>
  findById: (tx: Transaction, requestId: string) => Promise<EmailChangeRequest | null>
  latestCreatedAt: (tx: Transaction, userId: string) => Promise<Date | null>
  retireActive: (tx: Transaction, input: Readonly<{ userId: string; now: Date }>) => Promise<void>
  consume: (tx: Transaction, input: Readonly<{ requestId: string; now: Date }>) => Promise<boolean>
  incrementAttempt: (tx: Transaction, requestId: string) => Promise<void>
}

const toRequest = (row: {
  readonly id: string
  readonly user_id: string
  readonly target_ciphertext: Buffer
  readonly target_nonce: Buffer
  readonly target_key_version: string
  readonly code_hash: Buffer
  readonly code_key_version: string
  readonly bound_email_revision: string
  readonly bound_credential_version: string
  readonly attempt_count: number
  readonly expires_at: Date
  readonly created_at: Date
  readonly consumed_at: Date | null
}): EmailChangeRequest => ({
  id: row.id,
  userId: row.user_id,
  targetCiphertext: Buffer.from(row.target_ciphertext),
  targetNonce: Buffer.from(row.target_nonce),
  targetKeyVersion: row.target_key_version,
  codeHash: Buffer.from(row.code_hash),
  codeKeyVersion: row.code_key_version,
  boundEmailRevision: String(row.bound_email_revision),
  boundCredentialVersion: String(row.bound_credential_version),
  attemptCount: row.attempt_count,
  expiresAt: new Date(row.expires_at),
  createdAt: new Date(row.created_at),
  consumedAt: row.consumed_at === null ? null : new Date(row.consumed_at),
})

export const createEmailChangeRepository = (): EmailChangeRepository => ({
  create: async (tx, input) =>
    toRequest(
      await tx
        .insertInto("email_change_requests")
        .values({
          user_id: input.userId,
          target_ciphertext: input.targetCiphertext,
          target_nonce: input.targetNonce,
          target_key_version: input.targetKeyVersion,
          code_hash: input.codeHash,
          code_key_version: input.codeKeyVersion,
          bound_email_revision: input.boundEmailRevision,
          bound_credential_version: input.boundCredentialVersion,
          expires_at: input.expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    ),

  findActive: async (tx, userId) => {
    const row = await tx
      .selectFrom("email_change_requests")
      .selectAll()
      .where("user_id", "=", userId)
      .where("consumed_at", "is", null)
      .executeTakeFirst()
    return row === undefined ? null : toRequest(row)
  },

  lockActive: async (tx, userId) => {
    const row = await tx
      .selectFrom("email_change_requests")
      .selectAll()
      .where("user_id", "=", userId)
      .where("consumed_at", "is", null)
      .forUpdate()
      .executeTakeFirst()
    return row === undefined ? null : toRequest(row)
  },

  findById: async (tx, requestId) => {
    const row = await tx.selectFrom("email_change_requests").selectAll().where("id", "=", requestId).executeTakeFirst()
    return row === undefined ? null : toRequest(row)
  },

  latestCreatedAt: async (tx, userId) => {
    const row = await tx
      .selectFrom("email_change_requests")
      .select("created_at")
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst()
    return row === undefined ? null : new Date(row.created_at)
  },

  retireActive: async (tx, input) => {
    await tx
      .updateTable("email_change_requests")
      .set({ consumed_at: input.now })
      .where("user_id", "=", input.userId)
      .where("consumed_at", "is", null)
      .execute()
  },

  consume: async (tx, input) =>
    (
      await tx
        .updateTable("email_change_requests")
        .set({ consumed_at: input.now })
        .where("id", "=", input.requestId)
        .where("consumed_at", "is", null)
        .executeTakeFirst()
    ).numUpdatedRows === 1n,

  incrementAttempt: async (tx, requestId) => {
    await tx
      .updateTable("email_change_requests")
      .set({ attempt_count: sql<number>`attempt_count + 1` })
      .where("id", "=", requestId)
      .execute()
  },
})
