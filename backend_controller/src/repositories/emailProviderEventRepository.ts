/**
 * Amazon SES/SNS inbox repository (spec 03 §3.3/§7, 04 §6.3). Records signed
 * provider notifications exactly once (SNS MessageId uniqueness) with their raw
 * SHA-256 digest, then transitions each to a terminal classification. Payload
 * ciphertext columns are nullable; at-rest payload encryption is a later
 * hardening step, so this slice retains only the required digest.
 */
import type { EmailProviderEvent, Transaction } from "../db/repositories.js"
import type { EmailProviderEventState } from "../db/types.js"

export interface InsertProviderEventInput {
  readonly snsMessageId: string
  readonly snsTopicArn: string
  readonly snsType: string
  readonly sesEventType: string | null
  readonly sesMessageId: string | null
  readonly payloadSha256: Buffer
  readonly expiresAt: Date
}

export interface FinalizeProviderEventInput {
  readonly eventId: string
  readonly state: Exclude<EmailProviderEventState, "received">
  readonly emailDeliveryId: string | null
  readonly now: Date
}

export interface EmailProviderEventWriteRepository {
  /** Insert under the MessageId unique constraint; duplicates are reported. */
  insertReceived: (
    tx: Transaction,
    input: InsertProviderEventInput,
  ) => Promise<Readonly<{ event: EmailProviderEvent; duplicate: boolean }>>
  /** received -> processed | ignored | unmatched; sets processed_at and match. */
  finalize: (tx: Transaction, input: FinalizeProviderEventInput) => Promise<void>
}

export const createEmailProviderEventRepository = (): EmailProviderEventWriteRepository => ({
  insertReceived: async (tx, input) => {
    const inserted = await tx
      .insertInto("email_provider_events")
      .values({
        sns_message_id: input.snsMessageId,
        sns_topic_arn: input.snsTopicArn,
        sns_type: input.snsType,
        ses_event_type: input.sesEventType,
        ses_message_id: input.sesMessageId,
        payload_sha256: input.payloadSha256,
        expires_at: input.expiresAt,
      })
      .onConflict((oc) => oc.column("sns_message_id").doNothing())
      .returningAll()
      .executeTakeFirst()

    if (inserted !== undefined) return { event: inserted, duplicate: false }

    const existing = await tx
      .selectFrom("email_provider_events")
      .selectAll()
      .where("sns_message_id", "=", input.snsMessageId)
      .executeTakeFirstOrThrow()
    return { event: existing, duplicate: true }
  },

  finalize: async (tx, input) => {
    await tx
      .updateTable("email_provider_events")
      .set({
        state: input.state,
        processed_at: input.now,
        email_delivery_id: input.emailDeliveryId,
      })
      .where("id", "=", input.eventId)
      .where("state", "=", "received")
      .execute()
  },
})
