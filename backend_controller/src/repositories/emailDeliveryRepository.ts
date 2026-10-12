/**
 * Email delivery repository (spec 03 §3.3/§7, 04 §6.2). Owns the delivery
 * projection the worker sends and the monotonic evidence a provider event adds.
 * Recipient PII is stored as an AES-256-GCM envelope plus a keyed HMAC and a
 * masked display value; the raw address is never stored. `email_deliveries`
 * never owns the claim or retry schedule — that is the outbox's job.
 */
import { sql } from "kysely"

import type { EmailDelivery, EmailDeliveryPayload, Transaction } from "../db/repositories.js"

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

export interface CreateAccountApprovedDeliveryInput {
  readonly outboxEventId: string
  readonly userId: string
  readonly applicationId: string
  readonly recipientCiphertext: Buffer
  readonly recipientNonce: Buffer
  readonly recipientHmac: Buffer
  readonly recipientMasked: string
  readonly recipientEncryptionKeyVersion: string
  readonly suppressionHmacKeyVersion: string
  readonly sesConfigurationSet: string
  readonly templateVersion: string
}

export interface CreateRejectionDeliveryInput {
  readonly outboxEventId: string
  readonly applicationId: string
  readonly recipientCiphertext: Buffer
  readonly recipientNonce: Buffer
  readonly recipientHmac: Buffer
  readonly recipientMasked: string
  readonly recipientEncryptionKeyVersion: string
  readonly suppressionHmacKeyVersion: string
  readonly sesConfigurationSet: string
  readonly templateVersion: string
}

export type UserMailTemplateKey =
  | "password_set_link"
  | "password_reset_link"
  | "password_app_download"
  | "contact_phone_changed"
  | "email_change_code"
  | "contact_email_changed"
  | "admin_message"
  | "app_update_notice"

export interface CreateUserMailDeliveryInput {
  readonly outboxEventId: string
  readonly templateKey: UserMailTemplateKey
  readonly userId: string
  readonly recipientCiphertext: Buffer
  readonly recipientNonce: Buffer
  readonly recipientHmac: Buffer
  readonly recipientMasked: string
  readonly recipientEncryptionKeyVersion: string
  readonly suppressionHmacKeyVersion: string
  readonly sesConfigurationSet: string
  readonly templateVersion: string
}

export interface InsertSealedPayloadInput {
  readonly deliveryId: string
  readonly ciphertext: Buffer
  readonly nonce: Buffer
  readonly keyVersion: string
}

export interface AdminEmailDeliveryQuery {
  readonly states?: readonly EmailDelivery["state"][]
  readonly templateKeys?: readonly string[]
  readonly applicationId?: string
  readonly userId?: string
  readonly afterCreatedAt?: Date
  readonly afterId?: string
  readonly limit: number
}

export interface EmailDeliveryWriteRepository {
  /**
   * "Your account is open" mail for an approval. Carries a user and an
   * application but no redeemable reference — the credential already exists,
   * so there is nothing for the recipient to redeem.
   */
  createAccountApprovedDelivery: (
    tx: Transaction,
    input: CreateAccountApprovedDeliveryInput,
  ) => Promise<EmailDelivery>
  createRejectionDelivery: (tx: Transaction, input: CreateRejectionDeliveryInput) => Promise<EmailDelivery>
  createUserMailDelivery: (tx: Transaction, input: CreateUserMailDeliveryInput) => Promise<EmailDelivery>
  insertSealedPayload: (tx: Transaction, input: InsertSealedPayloadInput) => Promise<void>
  findSealedPayload: (tx: Transaction, deliveryId: string) => Promise<EmailDeliveryPayload | null>
  adminList: (tx: Transaction, query: AdminEmailDeliveryQuery) => Promise<readonly EmailDelivery[]>
  listByApplication: (
    tx: Transaction,
    input: Readonly<{ applicationId: string; afterCreatedAt?: Date; afterId?: string; limit: number }>,
  ) => Promise<readonly EmailDelivery[]>
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

const appliedToOne = (result: { readonly numUpdatedRows: bigint }): boolean => Number(result.numUpdatedRows) === 1

export const scrubSealedPayload = async (tx: Transaction, deliveryId: string, now: Date): Promise<void> => {
  await tx
    .updateTable("email_delivery_payloads")
    .set({ ciphertext: null, nonce: null, scrubbed_at: now })
    .where("email_delivery_id", "=", deliveryId)
    .where("scrubbed_at", "is", null)
    .execute()
}

export const createEmailDeliveryRepository = (): EmailDeliveryWriteRepository => ({
  createAccountApprovedDelivery: async (tx, input) =>
    tx
      .insertInto("email_deliveries")
      .values({
        outbox_event_id: input.outboxEventId,
        user_id: input.userId,
        application_id: input.applicationId,
        template_key: "account_approved",
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

  createRejectionDelivery: async (tx, input) =>
    tx
      .insertInto("email_deliveries")
      .values({
        outbox_event_id: input.outboxEventId,
        application_id: input.applicationId,
        template_key: "application_rejected",
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

  createUserMailDelivery: async (tx, input) =>
    tx
      .insertInto("email_deliveries")
      .values({
        outbox_event_id: input.outboxEventId,
        user_id: input.userId,
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

  insertSealedPayload: async (tx, input) => {
    await tx
      .insertInto("email_delivery_payloads")
      .values({
        email_delivery_id: input.deliveryId,
        ciphertext: input.ciphertext,
        nonce: input.nonce,
        key_version: input.keyVersion,
      })
      .execute()
  },

  findSealedPayload: async (tx, deliveryId) => {
    const row = await tx
      .selectFrom("email_delivery_payloads")
      .selectAll()
      .where("email_delivery_id", "=", deliveryId)
      .executeTakeFirst()
    return row ?? null
  },

  adminList: async (tx, query) => {
    let builder = tx.selectFrom("email_deliveries").selectAll()
    if (query.states !== undefined && query.states.length > 0) {
      builder = builder.where("state", "in", [...query.states])
    }
    if (query.templateKeys !== undefined && query.templateKeys.length > 0) {
      builder = builder.where("template_key", "in", [...query.templateKeys])
    }
    if (query.applicationId !== undefined) builder = builder.where("application_id", "=", query.applicationId)
    if (query.userId !== undefined) builder = builder.where("user_id", "=", query.userId)
    if (query.afterCreatedAt !== undefined && query.afterId !== undefined) {
      const afterCreatedAt = query.afterCreatedAt
      const afterId = query.afterId
      builder = builder.where((eb) =>
        eb.or([
          eb("created_at", "<", afterCreatedAt),
          eb.and([eb("created_at", "=", afterCreatedAt), eb("id", "<", afterId)]),
        ]),
      )
    }
    return builder.orderBy("created_at", "desc").orderBy("id", "desc").limit(query.limit).execute()
  },

  listByApplication: async (tx, input) => {
    let builder = tx.selectFrom("email_deliveries").selectAll().where("application_id", "=", input.applicationId)
    if (input.afterCreatedAt !== undefined && input.afterId !== undefined) {
      const afterCreatedAt = input.afterCreatedAt
      const afterId = input.afterId
      builder = builder.where((eb) =>
        eb.or([
          eb("created_at", "<", afterCreatedAt),
          eb.and([eb("created_at", "=", afterCreatedAt), eb("id", "<", afterId)]),
        ]),
      )
    }
    return builder.orderBy("created_at", "desc").orderBy("id", "desc").limit(input.limit).execute()
  },

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
    const result = await tx
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
      .executeTakeFirst()
    if (appliedToOne(result)) await scrubSealedPayload(tx, input.deliveryId, input.now)
  },

  recordSendFailure: async (tx, input) => {
    const result = await tx
      .updateTable("email_deliveries")
      .set({
        state: input.permanent ? "permanent_failed" : "retryable_failed",
        last_error_code: input.errorCode,
        updated_at: input.now,
        version: nextVersion,
      })
      .where("id", "=", input.deliveryId)
      .where("state", "=", "sending")
      .executeTakeFirst()
    if (input.permanent && appliedToOne(result)) await scrubSealedPayload(tx, input.deliveryId, input.now)
  },

  cancel: async (tx, input) => {
    const result = await tx
      .updateTable("email_deliveries")
      .set({ state: "cancelled", cancelled_at: input.now, updated_at: input.now, version: nextVersion })
      .where("id", "=", input.deliveryId)
      .where("state", "in", ["queued", "retryable_failed", "sending"])
      .executeTakeFirst()
    if (appliedToOne(result)) await scrubSealedPayload(tx, input.deliveryId, input.now)
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
