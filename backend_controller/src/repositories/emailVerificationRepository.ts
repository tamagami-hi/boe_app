import { sql } from "kysely"

import type { Transaction, User } from "../db/repositories.js"
import type { EmailVerificationState } from "../db/types.js"

export interface EmailVerificationRecord {
  readonly userId: string
  readonly state: EmailVerificationState
  readonly expiresAt: Date | null
  readonly submittedAt: Date | null
  readonly verifiedAt: Date | null
}

export interface EmailVerificationCode {
  readonly id: string
  readonly userId: string
  readonly codeHash: Buffer
  readonly codeKeyVersion: string
  readonly attemptCount: number
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly createdAt: Date
}

export interface EmailVerificationRepository {
  findVerifiedByUser: (tx: Transaction, userId: string) => Promise<EmailVerificationRecord | null>
  findLatestByUser: (tx: Transaction, userId: string) => Promise<EmailVerificationRecord | null>
  start: (tx: Transaction, input: Readonly<{ userId: string; now: Date }>) => Promise<EmailVerificationRecord | null>
  markVerified: (
    tx: Transaction,
    input: Readonly<{ userId: string; expiresAt: Date; now: Date }>,
  ) => Promise<EmailVerificationRecord | null>
  lockActiveCode: (tx: Transaction, userId: string) => Promise<EmailVerificationCode | null>
  latestCodeCreatedAt: (tx: Transaction, userId: string) => Promise<Date | null>
  consumeActiveCode: (tx: Transaction, input: Readonly<{ userId: string; now: Date }>) => Promise<void>
  createCode: (
    tx: Transaction,
    input: Readonly<{
      userId: string
      codeHash: Buffer
      codeKeyVersion: string
      expiresAt: Date
    }>,
  ) => Promise<EmailVerificationCode>
  incrementCodeAttempt: (tx: Transaction, codeId: string) => Promise<void>
  consumeCode: (tx: Transaction, input: Readonly<{ codeId: string; now: Date }>) => Promise<void>
}

type VerificationUser = Pick<
  User,
  | "id"
  | "email_verification_state"
  | "email_verification_expires_at"
  | "email_verification_started_at"
  | "email_verified_at"
>

const recordFromUser = (user: VerificationUser): EmailVerificationRecord => ({
  userId: user.id,
  state: user.email_verification_state,
  expiresAt: user.email_verification_expires_at,
  submittedAt: user.email_verification_started_at,
  verifiedAt: user.email_verified_at,
})

const recordQuery = (tx: Transaction, userId: string) =>
  tx
    .selectFrom("users")
    .select([
      "id",
      "email_verification_state",
      "email_verification_expires_at",
      "email_verification_started_at",
      "email_verified_at",
    ])
    .where("id", "=", userId)

const mapCode = (row: {
  readonly id: string
  readonly user_id: string
  readonly code_hash: Buffer
  readonly code_key_version: string
  readonly attempt_count: number
  readonly expires_at: Date
  readonly consumed_at: Date | null
  readonly created_at: Date
}): EmailVerificationCode => ({
  id: row.id,
  userId: row.user_id,
  codeHash: row.code_hash,
  codeKeyVersion: row.code_key_version,
  attemptCount: row.attempt_count,
  expiresAt: row.expires_at,
  consumedAt: row.consumed_at,
  createdAt: row.created_at,
})

export const createEmailVerificationRepository = (): EmailVerificationRepository => ({
  findVerifiedByUser: async (tx, userId) => {
    const row = await recordQuery(tx, userId).where("email_verification_state", "=", "verified").executeTakeFirst()
    return row === undefined ? null : recordFromUser(row)
  },

  findLatestByUser: async (tx, userId) => {
    const row = await recordQuery(tx, userId).executeTakeFirst()
    return row === undefined ? null : recordFromUser(row)
  },

  start: async (tx, input) => {
    const row = await tx
      .updateTable("users")
      .set({
        email_verification_state: "pending",
        email_verification_started_at: sql<Date>`coalesce(email_verification_started_at, ${input.now})`,
        email_verification_expires_at: null,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.userId)
      .returning([
        "id",
        "email_verification_state",
        "email_verification_expires_at",
        "email_verification_started_at",
        "email_verified_at",
      ])
      .executeTakeFirst()
    return row === undefined ? null : recordFromUser(row)
  },

  markVerified: async (tx, input) => {
    const row = await tx
      .updateTable("users")
      .set({
        email_verification_state: "verified",
        email_verified_at: input.now,
        email_verification_expires_at: input.expiresAt,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.userId)
      .where("email_verification_state", "=", "pending")
      .returning([
        "id",
        "email_verification_state",
        "email_verification_expires_at",
        "email_verification_started_at",
        "email_verified_at",
      ])
      .executeTakeFirst()
    return row === undefined ? null : recordFromUser(row)
  },

  lockActiveCode: async (tx, userId) => {
    const row = await tx
      .selectFrom("email_verification_codes")
      .selectAll()
      .where("user_id", "=", userId)
      .where("consumed_at", "is", null)
      .forUpdate()
      .executeTakeFirst()
    return row === undefined ? null : mapCode(row)
  },

  latestCodeCreatedAt: async (tx, userId) => {
    const row = await tx
      .selectFrom("email_verification_codes")
      .select("created_at")
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst()
    return row === undefined ? null : new Date(row.created_at)
  },

  consumeActiveCode: async (tx, input) => {
    await tx
      .updateTable("email_verification_codes")
      .set({ consumed_at: input.now })
      .where("user_id", "=", input.userId)
      .where("consumed_at", "is", null)
      .execute()
  },

  createCode: async (tx, input) => {
    const row = await tx
      .insertInto("email_verification_codes")
      .values({
        user_id: input.userId,
        code_hash: input.codeHash,
        code_key_version: input.codeKeyVersion,
        expires_at: input.expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapCode(row)
  },

  incrementCodeAttempt: async (tx, codeId) => {
    await tx
      .updateTable("email_verification_codes")
      .set({ attempt_count: sql<number>`attempt_count + 1` })
      .where("id", "=", codeId)
      .execute()
  },

  consumeCode: async (tx, input) => {
    await tx
      .updateTable("email_verification_codes")
      .set({ consumed_at: input.now })
      .where("id", "=", input.codeId)
      .where("consumed_at", "is", null)
      .execute()
  },
})
