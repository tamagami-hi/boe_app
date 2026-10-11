import type { CryptoContext, DeliveryPayload } from "../../crypto/context.js"
import type { EmailDelivery, OutboxEvent, Transaction } from "../../db/repositories.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { EnqueueOutboxInput, OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import { EMAIL_TOPIC, SEALED_EMAIL_TOPIC } from "./emailTopics.js"

export interface EnqueueEmailDeps {
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly crypto: CryptoContext
}

export type EmailTemplateSubject =
  | { readonly templateKey: "account_approved"; readonly userId: string; readonly applicationId: string }
  | { readonly templateKey: "application_rejected"; readonly applicationId: string }

export interface EnqueueEmailInput extends Omit<EnqueueOutboxInput, "topic"> {
  readonly recipient: string
  readonly template: EmailTemplateSubject
  readonly templateVersion: string
  readonly sesConfigurationSet: string
  readonly sealedPayload?: DeliveryPayload
}

export interface EnqueuedEmail {
  readonly outbox: OutboxEvent
  readonly delivery: EmailDelivery
}

export const enqueueEmail = async (
  tx: Transaction,
  deps: EnqueueEmailDeps,
  input: EnqueueEmailInput,
): Promise<EnqueuedEmail> => {
  const outbox = await deps.outboxRepository.enqueue(tx, {
    topic: input.sealedPayload === undefined ? EMAIL_TOPIC : SEALED_EMAIL_TOPIC,
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    requestId: input.requestId,
    deduplicationKey: input.deduplicationKey,
    payload: input.payload,
  })

  const envelope = deps.crypto.encryptRecipient(input.recipient)
  const recipientEvidence = {
    outboxEventId: outbox.id,
    recipientCiphertext: envelope.ciphertext,
    recipientNonce: envelope.nonce,
    recipientHmac: deps.crypto.hmacRecipient(input.recipient).hash,
    recipientMasked: deps.crypto.maskEmail(input.recipient),
    recipientEncryptionKeyVersion: envelope.keyVersion,
    suppressionHmacKeyVersion: deps.crypto.suppressionHmacKeyVersion,
    sesConfigurationSet: input.sesConfigurationSet,
    templateVersion: input.templateVersion,
  }
  const { template } = input
  const delivery =
    template.templateKey === "account_approved"
      ? await deps.emailDeliveryRepository.createAccountApprovedDelivery(tx, {
          userId: template.userId,
          applicationId: template.applicationId,
          ...recipientEvidence,
        })
      : await deps.emailDeliveryRepository.createRejectionDelivery(tx, {
          applicationId: template.applicationId,
          ...recipientEvidence,
        })

  if (input.sealedPayload !== undefined) {
    const sealed = deps.crypto.encryptDeliveryPayload(delivery.id, input.sealedPayload)
    await deps.emailDeliveryRepository.insertSealedPayload(tx, {
      deliveryId: delivery.id,
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
      keyVersion: sealed.keyVersion,
    })
  }

  return { outbox, delivery }
}
