/**
 * KYC write repository (spec 03 §4.1; decisions 8-9). Owns the `kyc_cases`
 * lifecycle used by the email-OTP flow plus the `kyc_verification_codes` table.
 * A user has at most one open (nonterminal) case (DB partial-unique), so the
 * flow locks/reuses the open case rather than creating duplicates. Codes are
 * stored only as a 32-byte keyed hash; the raw code never touches the database.
 */
import { sql } from "kysely"

import type { KycCase, KycVerificationCode, Transaction } from "../db/repositories.js"

export interface KycWriteRepository {
  /** The user's current approved case (if any), for the already-verified short-circuit. */
  findApprovedByUser: (tx: Transaction, userId: string) => Promise<KycCase | null>
  /** The investor's most recent case in any state — what the status screen reads. */
  findLatestByUser: (tx: Transaction, userId: string) => Promise<KycCase | null>
  /** Lock the user's open (nonterminal) case, or null. */
  lockOpenCaseByUser: (tx: Transaction, userId: string) => Promise<KycCase | null>
  /** Create a new email-OTP case (`pending_submission`, provider `email_otp`). */
  createCase: (tx: Transaction, userId: string) => Promise<KycCase>
  /** pending_submission|submitted -> submitted (sets submitted_at once). */
  markSubmitted: (
    tx: Transaction,
    input: Readonly<{ caseId: string; userId: string; now: Date }>,
  ) => Promise<KycCase | null>
  /** submitted -> approved (sets decided_at + expiry). */
  approveCase: (
    tx: Transaction,
    input: Readonly<{ caseId: string; userId: string; expiresAt: Date; now: Date }>,
  ) => Promise<KycCase | null>

  /** The active (unconsumed) code for a case, locked, or null. */
  lockActiveCode: (tx: Transaction, kycCaseId: string) => Promise<KycVerificationCode | null>
  /** Timestamp of the most recent code for a case (resend cooldown), or null. */
  latestCodeCreatedAt: (tx: Transaction, kycCaseId: string) => Promise<Date | null>
  /** Consume (deactivate) the active code so a fresh one can be issued. */
  consumeActiveCode: (tx: Transaction, input: Readonly<{ kycCaseId: string; now: Date }>) => Promise<void>
  createCode: (
    tx: Transaction,
    input: Readonly<{
      kycCaseId: string
      userId: string
      codeHash: Buffer
      codeKeyVersion: string
      expiresAt: Date
    }>,
  ) => Promise<KycVerificationCode>
  incrementCodeAttempt: (tx: Transaction, codeId: string) => Promise<void>
  consumeCode: (tx: Transaction, input: Readonly<{ codeId: string; now: Date }>) => Promise<void>
}

const NONTERMINAL_STATES = ["pending_submission", "submitted", "in_review", "needs_information"] as const

export const createKycRepository = (): KycWriteRepository => ({
  findApprovedByUser: async (tx, userId) => {
    const row = await tx
      .selectFrom("kyc_cases")
      .selectAll()
      .where("user_id", "=", userId)
      .where("state", "=", "approved")
      .orderBy("decided_at", "desc")
      .limit(1)
      .executeTakeFirst()
    return row ?? null
  },

  findLatestByUser: async (tx, userId) => {
    const row = await tx
      .selectFrom("kyc_cases")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst()
    return row ?? null
  },

  lockOpenCaseByUser: async (tx, userId) => {
    const row = await tx
      .selectFrom("kyc_cases")
      .selectAll()
      .where("user_id", "=", userId)
      .where("state", "in", [...NONTERMINAL_STATES])
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  createCase: async (tx, userId) =>
    tx
      .insertInto("kyc_cases")
      .values({ user_id: userId, provider: "email_otp" })
      .returningAll()
      .executeTakeFirstOrThrow(),

  markSubmitted: async (tx, input) => {
    const row = await tx
      .updateTable("kyc_cases")
      .set({
        state: "submitted",
        submitted_at: sql<Date>`coalesce(submitted_at, ${input.now})`,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.caseId)
      .where("user_id", "=", input.userId)
      .where("state", "in", ["pending_submission", "submitted"])
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  approveCase: async (tx, input) => {
    const row = await tx
      .updateTable("kyc_cases")
      .set({
        state: "approved",
        decided_at: input.now,
        expires_at: input.expiresAt,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.caseId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "submitted")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  lockActiveCode: async (tx, kycCaseId) => {
    const row = await tx
      .selectFrom("kyc_verification_codes")
      .selectAll()
      .where("kyc_case_id", "=", kycCaseId)
      .where("consumed_at", "is", null)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  latestCodeCreatedAt: async (tx, kycCaseId) => {
    const row = await tx
      .selectFrom("kyc_verification_codes")
      .select("created_at")
      .where("kyc_case_id", "=", kycCaseId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst()
    return row?.created_at === undefined ? null : new Date(row.created_at)
  },

  consumeActiveCode: async (tx, input) => {
    await tx
      .updateTable("kyc_verification_codes")
      .set({ consumed_at: input.now })
      .where("kyc_case_id", "=", input.kycCaseId)
      .where("consumed_at", "is", null)
      .execute()
  },

  createCode: async (tx, input) =>
    tx
      .insertInto("kyc_verification_codes")
      .values({
        kyc_case_id: input.kycCaseId,
        user_id: input.userId,
        code_hash: input.codeHash,
        code_key_version: input.codeKeyVersion,
        expires_at: input.expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  incrementCodeAttempt: async (tx, codeId) => {
    await tx
      .updateTable("kyc_verification_codes")
      .set({ attempt_count: sql<number>`attempt_count + 1` })
      .where("id", "=", codeId)
      .execute()
  },

  consumeCode: async (tx, input) => {
    await tx
      .updateTable("kyc_verification_codes")
      .set({ consumed_at: input.now })
      .where("id", "=", input.codeId)
      .execute()
  },
})
