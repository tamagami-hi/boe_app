/**
 * Notification write repository (spec 03 §4.4). User-facing notifications carry
 * an allowlisted JSON payload and never contain provider payloads, tokens, KYC
 * identifiers, or sensitive audit detail.
 */
import type { Notification, Transaction } from "../db/repositories.js"

export interface CreateNotificationInput {
  readonly userId: string
  readonly kind: string
  readonly title: string
  readonly body: string
  readonly payload?: Readonly<Record<string, unknown>>
}

export interface NotificationWriteRepository {
  create: (tx: Transaction, input: CreateNotificationInput) => Promise<Notification>
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
})
