/**
 * Email delivery repository (spec 03 §3.3/§7, 04 §6.2). Owns the delivery
 * projection the worker sends and the monotonic evidence a provider event adds.
 * Recipient PII is stored as an AES-256-GCM envelope plus a keyed HMAC and a
 * masked display value; the raw address is never stored. `email_deliveries`
 * never owns the claim or retry schedule — that is the outbox's job.
 */
import { sql } from "kysely"

import type { EmailDelivery, Transaction } from "../db/repositories.js"

export interface CreateEmailDeliveryInput {
  readonly outboxEventId: string
  readonly applicationId: string
  readonly verificationTokenId: string
  readonly templateKey: string
  readonly templateVersion: string
  readonly recipientCiphertext: Buffer
  readonly recipientNonce: Buffer
  readonly recipientHmac: Buffer
  readonly recipientMasked: string
  readonly recipientEncryptionKeyVersion: string
  readonly suppressionHmacKeyVersion: string
  readonly sesConfigurationSet: string
}

export interface RecordSentInput {
  readonly deliveryId: string
  readonly sesMessageId: string
  readonly sesRequestId: string | null
  readonly now: Date
}

export interface RecordSendFailureInput {
  readonly deliveryId: string
  readonly errorCode: string
  readonly permanent: boolean
  readonly now: Date
}

/** Monotonic evidence a provider event contributes; delivered never regresses. */
export type DeliveryEvidence = "delivered" | "bounced" | "complained"

export interface EmailDeliveryWriteRepository {
  create: (tx: Transaction, input: CreateEmailDeliveryInput) => Promise<EmailDelivery>
  lockByOutboxEventId: (tx: Transaction, outboxEventId: string) => Promise<EmailDelivery | null>
  lockById: (tx: Transaction, deliveryId: string) => Promise<EmailDelivery | null>
  lockBySesMessageId: (tx: Transaction, sesMessageId: string) => Promise<EmailDelivery | null>
  /** queued|retryable_failed -> sending; increments the attempt count. */
  transitionSending: (tx: Transaction, input: Readonly<{ deliveryId: string; now: Date }>) => Promise<void>
  /** sending -> sent; records the SES MessageId and acceptance time. */
  recordSent: (tx: Transaction, input: RecordSentInput) => Promise<void>
  /** sending -> retryable_failed | permanent_failed with a stable error code. */
  recordSendFailure: (tx: Transaction, input: RecordSendFailureInput) => Promise<void>
  /** any pre-terminal state -> cancelled (revoked/suppressed before sending). */
  cancel: (tx: Transaction, input: Readonly<{ deliveryId: string; now: Date }>) => Promise<void>
  /** Add monotonic delivery/bounce/complaint evidence from a provider event. */
  applyEvidence: (
    tx: Transaction,
    input: Readonly<{ deliveryId: string; evidence: DeliveryEvidence; now: Date }>,
  ) => Promise<void>
}

const nextVersion = sql<string>`version + 1`

export const createEmailDeliveryRepository = (): EmailDeliveryWriteRepository => ({
  create: async (tx, input) =>
    tx
      .insertInto("email_deliveries")
      .values({
        outbox_event_id: input.outboxEventId,
        application_id: input.applicationId,
        verification_token_id: input.verificationTokenId,
        template_key: input.templateKey,
        template_version: input.templateVersion,
        recipient_ciphertext: input.recipientCiphertext,
        recipient_nonce: input.recipientNonce,
        recipient_hmac: input.recipientHmac,
        recipient_masked: input.recipientMasked,
        recipient_encryption_key_version: input.recipientEncryptionKeyVersion,
        suppression_hmac_key_version: input.suppressionHmacKeyVersion,
        ses_configuration_set: input.sesConfigurationSet,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  lockByOutboxEventId: async (tx, outboxEventId) => {
    const row = await tx
      .selectFrom("email_deliveries")
      .selectAll()
      .where("outbox_event_id", "=", outboxEventId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  lockById: async (tx, deliveryId) => {
    const row = await tx
      .selectFrom("email_deliveries")
      .selectAll()
      .where("id", "=", deliveryId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  lockBySesMessageId: async (tx, sesMessageId) => {
    const row = await tx
      .selectFrom("email_deliveries")
      .selectAll()
      .where("ses_message_id", "=", sesMessageId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  transitionSending: async (tx, input) => {
    await tx
      .updateTable("email_deliveries")
      .set({
        state: "sending",
        attempt_count: sql<number>`attempt_count + 1`,
        last_attempt_at: input.now,
        updated_at: input.now,
        version: nextVersion,
      })
      .where("id", "=", input.deliveryId)
      .where("state", "in", ["queued", "retryable_failed"])
      .execute()
  },

  recordSent: async (tx, input) => {
    await tx
      .updateTable("email_deliveries")
      .set({
        state: "sent",
        ses_message_id: input.sesMessageId,
        ses_request_id: input.sesRequestId,
        sent_at: input.now,
        last_error_code: null,
        updated_at: input.now,
        version: nextVersion,
      })
      .where("id", "=", input.deliveryId)
      .where("state", "=", "sending")
      .execute()
  },

  recordSendFailure: async (tx, input) => {
    await tx
      .updateTable("email_deliveries")
      .set({
        state: input.permanent ? "permanent_failed" : "retryable_failed",
        last_error_code: input.errorCode,
        updated_at: input.now,
        version: nextVersion,
      })
      .where("id", "=", input.deliveryId)
      .where("state", "=", "sending")
      .execute()
  },

  cancel: async (tx, input) => {
    await tx
      .updateTable("email_deliveries")
      .set({ state: "cancelled", cancelled_at: input.now, updated_at: input.now, version: nextVersion })
      .where("id", "=", input.deliveryId)
      .where("state", "in", ["queued", "retryable_failed", "sending"])
      .execute()
  },

  applyEvidence: async (tx, input) => {
    if (input.evidence === "delivered") {
      // sent|sending|delivered -> delivered; never regresses a terminal state.
      await tx
        .updateTable("email_deliveries")
        .set({ state: "delivered", delivered_at: input.now, updated_at: input.now, version: nextVersion })
        .where("id", "=", input.deliveryId)
        .where("state", "in", ["sent", "sending", "delivered"])
        .execute()
      return
    }
    if (input.evidence === "bounced") {
      await tx
        .updateTable("email_deliveries")
        .set({ bounced_at: input.now, updated_at: input.now, version: nextVersion })
        .where("id", "=", input.deliveryId)
        .where("state", "!=", "cancelled")
        .execute()
      return
    }
    await tx
      .updateTable("email_deliveries")
      .set({ complained_at: input.now, updated_at: input.now, version: nextVersion })
      .where("id", "=", input.deliveryId)
      .where("state", "!=", "cancelled")
      .execute()
  },
})
