/**
 * Provider-events inbox repository (spec §5.4). Durable, deduplicated inbox for
 * authenticated PhonePe callbacks. A row is written only after the callback's
 * SHA authorization verified against the exact raw bytes (the schema CHECKs
 * `signature_valid`), carrying the semantic dedup key, the raw payload digest,
 * and the encrypted payload envelope.
 *
 * Processing is synchronous inside the webhook request: the route inserts the
 * verified row, attaches the payment correlation, and settles it `processed` in
 * the same transaction. There is no background drain, so a callback whose
 * processing fails is recovered only by PhonePe redelivery or by the
 * reconciliation pass polling provider state. The `provider_events` lease and
 * backoff columns and the `processing` / `dead_lettered` states remain in the
 * schema unused.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export interface InsertVerifiedProviderEventInput {
  readonly provider: string
  readonly eventType: string
  readonly dedupKey: string
  readonly payloadCiphertext: Buffer
  readonly payloadNonce: Buffer
  readonly payloadKeyVersion: string
  readonly payloadSha256: Buffer
  readonly merchantOrderId: string | null
}

export interface InsertVerifiedProviderEventResult {
  readonly eventId: string
  /** True when the dedup key was already present; the insert was skipped. */
  readonly isDuplicate: boolean
}

export interface ProviderEventInboxRepository {
  insertVerified: (
    tx: Transaction,
    input: InsertVerifiedProviderEventInput,
  ) => Promise<InsertVerifiedProviderEventResult>
  /** Attach the resolved payment correlation once known. */
  attachPayment: (
    tx: Transaction,
    input: Readonly<{ eventId: string; paymentId: string; userId: string; now: Date }>,
  ) => Promise<void>
  markProcessed: (
    tx: Transaction,
    input: Readonly<{ eventId: string; now: Date }>,
  ) => Promise<void>
}

export const createProviderEventInboxRepository = (): ProviderEventInboxRepository => ({
  insertVerified: async (tx, input) => {
    const inserted = await tx
      .insertInto("provider_events")
      .values({
        provider: input.provider,
        event_type: input.eventType,
        dedup_key: input.dedupKey,
        signature_valid: true,
        payload_ciphertext: input.payloadCiphertext,
        payload_nonce: input.payloadNonce,
        payload_key_version: input.payloadKeyVersion,
        payload_sha256: input.payloadSha256,
        merchant_order_id: input.merchantOrderId,
      })
      .onConflict((builder) => builder.columns(["provider", "dedup_key"]).doNothing())
      .returning("id")
      .executeTakeFirst()

    if (inserted !== undefined) return { eventId: inserted.id, isDuplicate: false }

    const existing = await tx
      .selectFrom("provider_events")
      .select("id")
      .where("provider", "=", input.provider)
      .where("dedup_key", "=", input.dedupKey)
      .executeTakeFirstOrThrow()
    return { eventId: existing.id, isDuplicate: true }
  },

  attachPayment: async (tx, input) => {
    await tx
      .updateTable("provider_events")
      .set({ payment_id: input.paymentId, user_id: input.userId, updated_at: input.now })
      .where("id", "=", input.eventId)
      .execute()
  },

  markProcessed: async (tx, input) => {
    await tx
      .updateTable("provider_events")
      .set({
        state: "processed",
        processed_at: input.now,
        locked_at: null,
        locked_by: null,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.eventId)
      .execute()
  },
})
