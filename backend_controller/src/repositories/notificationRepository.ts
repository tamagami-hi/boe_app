/**
 * Notification write repository (spec 03 §4.4). User-facing notifications carry
 * an allowlisted JSON payload and never contain provider payloads, Email OTP
 * identifiers, or sensitive audit detail.
 */
import { sql } from "kysely"

import type { Notification, Transaction } from "../db/repositories.js"

export interface CreateNotificationInput {
  readonly userId: string
  readonly kind: string
  readonly title: string
  readonly body: string
  readonly payload?: Readonly<Record<string, unknown>>
}

/** Locate an existing unread notification for a specific payload value. */
export interface FindUnreadByPayloadInput {
  readonly userId: string
  readonly kind: string
  /** Payload key to match on, e.g. `versionCode`. */
  readonly payloadKey: string
  /** Value the key must equal, compared as JSON text. */
  readonly payloadValue: string
}

export interface MarkKindReadInput {
  readonly userId: string
  readonly kind: string
  readonly now: Date
}

export interface NotificationWriteRepository {
  create: (tx: Transaction, input: CreateNotificationInput) => Promise<Notification>
  /**
   * Whether an unread notification of this kind already exists for this payload
   * value.
   *
   * The table has no unique constraint and `create` has no upsert, so
   * de-duplication has to be a read-then-write inside the caller's transaction.
   * Without it, a recurring producer — like an app-version report that fires on
   * every launch — would add a row per launch and bury the inbox.
   */
  findUnreadByPayload: (tx: Transaction, input: FindUnreadByPayloadInput) => Promise<Notification | null>
  /**
   * Mark every unread notification of a kind read, and report how many changed.
   *
   * Used to retire an obsolete prompt once the condition behind it is gone (the
   * user updated the app), so the inbox reflects reality without a sweeper job.
   */
  markKindRead: (tx: Transaction, input: MarkKindReadInput) => Promise<number>
}

export const createNotificationRepository = (): NotificationWriteRepository => ({
  create: async (tx, input) =>
    tx
      .insertInto("notifications")
      .values({
        user_id: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        payload: JSON.stringify(input.payload ?? {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  findUnreadByPayload: async (tx, input) => {
    const row = await tx
      .selectFrom("notifications")
      .selectAll()
      .where("user_id", "=", input.userId)
      .where("kind", "=", input.kind)
      .where("read_at", "is", null)
      // `->>` yields text, so the caller passes the value already stringified.
      // This keeps the comparison independent of whether the producer wrote the
      // value as a JSON number or a JSON string.
      .where(sql<string>`payload ->> ${input.payloadKey}`, "=", input.payloadValue)
      .executeTakeFirst()
    return row ?? null
  },

  markKindRead: async (tx, input) => {
    const result = await tx
      .updateTable("notifications")
      .set({ read_at: input.now, updated_at: input.now })
      .where("user_id", "=", input.userId)
      .where("kind", "=", input.kind)
      .where("read_at", "is", null)
      .executeTakeFirst()
    return Number(result.numUpdatedRows)
  },
})
