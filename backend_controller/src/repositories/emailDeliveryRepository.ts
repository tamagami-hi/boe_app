/**
 * Email delivery repository (spec 03 §3.3/§7). Creates the delivery projection
 * the worker (BE-012) sends. Recipient PII is stored as an AES-256-GCM envelope
 * plus a keyed HMAC and a masked display value; the raw address is not stored.
 */
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

export interface EmailDeliveryWriteRepository {
  create: (tx: Transaction, input: CreateEmailDeliveryInput) => Promise<EmailDelivery>
}

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
})
