import { sql } from "kysely"

import type { Transaction, User, UserId } from "../db/repositories.js"
import type { EmailVerificationState, UserContactChangeKind } from "../db/types.js"

export type ContactClaimKind = "user" | "application"

export interface ContactClaims {
  readonly email: ContactClaimKind | null
  readonly phone: ContactClaimKind | null
}

export interface ContactClaimProbe {
  readonly emailNormalized?: string
  readonly phoneE164?: string
  readonly excludeUserId: string
}

export interface ContactChange {
  readonly userId: string
  readonly emailNormalized: string
  readonly phoneE164: string
  readonly expectedVersion: string
  readonly now: Date
}

export interface AppendContactHistoryInput {
  readonly userId: string
  readonly changeKind: UserContactChangeKind
  readonly previousEmail: string
  readonly previousPhone: string
  readonly newEmail: string
  readonly newPhone: string
  readonly actorUserId: string
  readonly requestId: string
  readonly reasonCode: string | null
  readonly reasonDetail: string | null
  readonly now: Date
}

export interface ContactHistoryEntry {
  readonly id: string
  readonly userId: string
  readonly changeKind: UserContactChangeKind
  readonly previousEmail: string
  readonly previousPhone: string
  readonly newEmail: string
  readonly newPhone: string
  readonly actorUserId: string
  readonly actorName: string | null
  readonly reasonCode: string | null
  readonly reasonDetail: string | null
  readonly createdAt: Date
}

export interface UserContactRepository {
  findContactClaims: (tx: Transaction, probe: ContactClaimProbe) => Promise<ContactClaims>
  isPhoneHeld: (tx: Transaction, phoneE164: string) => Promise<boolean>
  correctContacts: (tx: Transaction, change: ContactChange & { readonly emailChanged: boolean }) => Promise<User | null>
  releaseContacts: (tx: Transaction, change: ContactChange) => Promise<User | null>
  nextReleasePhone: (tx: Transaction) => Promise<string>
  findRelease: (tx: Transaction, userId: string) => Promise<ContactHistoryEntry | null>
  appendHistory: (tx: Transaction, input: AppendContactHistoryInput) => Promise<ContactHistoryEntry>
  listHistory: (tx: Transaction, input: Readonly<{ userId: string; limit: number }>) => Promise<readonly ContactHistoryEntry[]>
}

const RELEASE_PHONE_PREFIX = "+999"
const RELEASE_NUMBER_DIGITS = 11

interface HistoryRow {
  readonly id: string
  readonly user_id: string
  readonly change_kind: UserContactChangeKind
  readonly previous_email_normalized: string
  readonly previous_phone_e164: string
  readonly new_email_normalized: string
  readonly new_phone_e164: string
  readonly actor_user_id: string
  readonly actor_name: string | null
  readonly reason_code: string | null
  readonly reason_detail: string | null
  readonly created_at: Date | string
}

const mapHistory = (row: HistoryRow): ContactHistoryEntry => ({
  id: row.id,
  userId: row.user_id,
  changeKind: row.change_kind,
  previousEmail: row.previous_email_normalized,
  previousPhone: row.previous_phone_e164,
  newEmail: row.new_email_normalized,
  newPhone: row.new_phone_e164,
  actorUserId: row.actor_user_id,
  actorName: row.actor_name,
  reasonCode: row.reason_code,
  reasonDetail: row.reason_detail,
  createdAt: new Date(row.created_at),
})

const historyQuery = (tx: Transaction) =>
  tx
    .selectFrom("user_contact_history as h")
    .leftJoin("users as a", "a.id", "h.actor_user_id")
    .select([
      "h.id",
      "h.user_id",
      "h.change_kind",
      "h.previous_email_normalized",
      "h.previous_phone_e164",
      "h.new_email_normalized",
      "h.new_phone_e164",
      "h.actor_user_id",
      "a.full_name as actor_name",
      "h.reason_code",
      "h.reason_detail",
      "h.created_at",
    ])

const claimOf = async (
  tx: Transaction,
  column: "email_normalized" | "phone_e164",
  value: string | undefined,
  excludeUserId: string,
): Promise<ContactClaimKind | null> => {
  if (value === undefined) return null
  const user = await tx
    .selectFrom("users")
    .select("id")
    .where(column, "=", value)
    .where("id", "<>", excludeUserId as UserId)
    .limit(1)
    .executeTakeFirst()
  if (user !== undefined) return "user"
  const application = await tx
    .selectFrom("applications")
    .select("id")
    .where(column, "=", value)
    .where("state", "=", "submitted")
    .limit(1)
    .executeTakeFirst()
  return application === undefined ? null : "application"
}

export const createUserContactRepository = (): UserContactRepository => ({
  findContactClaims: async (tx, probe) => ({
    email: await claimOf(tx, "email_normalized", probe.emailNormalized, probe.excludeUserId),
    phone: await claimOf(tx, "phone_e164", probe.phoneE164, probe.excludeUserId),
  }),

  isPhoneHeld: async (tx, phoneE164) =>
    (await tx.selectFrom("users").select("id").where("phone_e164", "=", phoneE164).executeTakeFirst()) !== undefined,

  correctContacts: async (tx, change) =>
    (await tx
      .updateTable("users")
      .set({
        email_normalized: change.emailNormalized,
        phone_e164: change.phoneE164,
        ...(change.emailChanged
          ? {
              email_revision: sql<string>`email_revision + 1`,
              email_verification_state: sql<EmailVerificationState>`case when email_verification_state = 'verified' then 'pending' else email_verification_state end`,
              email_verified_at: null,
            }
          : {}),
        updated_at: change.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", change.userId as UserId)
      .where("version", "=", change.expectedVersion)
      .where("account_state", "=", "active")
      .returningAll()
      .executeTakeFirst()) ?? null,

  releaseContacts: async (tx, change) =>
    (await tx
      .updateTable("users")
      .set({
        email_normalized: change.emailNormalized,
        phone_e164: change.phoneE164,
        email_revision: sql<string>`email_revision + 1`,
        updated_at: change.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", change.userId as UserId)
      .where("version", "=", change.expectedVersion)
      .where("account_state", "=", "closed")
      .returningAll()
      .executeTakeFirst()) ?? null,

  nextReleasePhone: async (tx) => {
    const result = await sql<{ number: string }>`
      select nextval('user_contact_release_number_seq')::text as number
    `.execute(tx)
    const drawn = result.rows[0]?.number
    if (drawn === undefined) throw new Error("user_contact_release_number_seq returned no value")
    return `${RELEASE_PHONE_PREFIX}${drawn.padStart(RELEASE_NUMBER_DIGITS, "0")}`
  },

  findRelease: async (tx, userId) => {
    const row = await historyQuery(tx)
      .where("h.user_id", "=", userId)
      .where("h.change_kind", "=", "closed_release")
      .executeTakeFirst()
    return row === undefined ? null : mapHistory(row)
  },

  appendHistory: async (tx, input) => {
    const inserted = await tx
      .insertInto("user_contact_history")
      .values({
        user_id: input.userId,
        change_kind: input.changeKind,
        previous_email_normalized: input.previousEmail,
        previous_phone_e164: input.previousPhone,
        new_email_normalized: input.newEmail,
        new_phone_e164: input.newPhone,
        actor_user_id: input.actorUserId,
        request_id: input.requestId,
        reason_code: input.reasonCode,
        reason_detail: input.reasonDetail,
        created_at: input.now,
      })
      .returning("id")
      .executeTakeFirstOrThrow()
    const row = await historyQuery(tx).where("h.id", "=", inserted.id).executeTakeFirstOrThrow()
    return mapHistory(row)
  },

  listHistory: async (tx, input) =>
    (
      await historyQuery(tx)
        .where("h.user_id", "=", input.userId)
        .orderBy("h.created_at", "desc")
        .orderBy("h.id", "desc")
        .limit(input.limit)
        .execute()
    ).map(mapHistory),
})
