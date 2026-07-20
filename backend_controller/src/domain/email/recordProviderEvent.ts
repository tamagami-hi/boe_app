/**
 * SES/SNS provider-event recording command (spec 04 §6.3). Runs inside a
 * caller-owned transaction after the route has already established SNS
 * provenance. It durably records the event under the MessageId unique
 * constraint, then classifies it: a duplicate is a no-op; a non-notification or
 * unparsable inner payload is ignored; a notification is matched to its delivery
 * (by the signed `boe_delivery_id` tag, else by recorded SES MessageId) and adds
 * monotonic evidence and, for a permanent bounce or complaint, a suppression.
 */
import type { Transaction } from "../../db/repositories.js"
import { classifySesEvent } from "../../email/snsMessages.js"
import type { SesEvent, SnsEnvelope } from "../../email/snsMessages.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { EmailProviderEventWriteRepository } from "../../repositories/emailProviderEventRepository.js"
import type { EmailSuppressionWriteRepository } from "../../repositories/emailSuppressionRepository.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface RecordProviderEventDeps {
  readonly emailProviderEventRepository: EmailProviderEventWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly emailSuppressionRepository: EmailSuppressionWriteRepository
}

export interface RecordProviderEventInput {
  readonly envelope: SnsEnvelope
  readonly sesEvent: SesEvent | null
  readonly payloadSha256: Buffer
  readonly now: Date
  readonly expiresAt: Date
}

export type ProviderEventOutcome = "duplicate" | "ignored" | "unmatched" | "processed"

export interface RecordProviderEventResult {
  readonly outcome: ProviderEventOutcome
  readonly evidence: "delivered" | "bounced" | "complained" | null
  readonly suppressed: boolean
}

export const recordProviderEvent = async (
  tx: Transaction,
  deps: RecordProviderEventDeps,
  input: RecordProviderEventInput,
): Promise<RecordProviderEventResult> => {
  const { envelope, sesEvent } = input

  const inserted = await deps.emailProviderEventRepository.insertReceived(tx, {
    snsMessageId: envelope.MessageId,
    snsTopicArn: envelope.TopicArn,
    snsType: envelope.Type,
    sesEventType: sesEvent?.eventType ?? null,
    sesMessageId: sesEvent?.mail.messageId ?? null,
    payloadSha256: input.payloadSha256,
    expiresAt: input.expiresAt,
  })
  if (inserted.duplicate) return { outcome: "duplicate", evidence: null, suppressed: false }
  const eventId = inserted.event.id

  // Only signed SES configuration-set notifications carry delivery evidence;
  // subscription/unsubscribe control messages and unparsable payloads are
  // durably recorded and ignored.
  if (envelope.Type !== "Notification" || sesEvent === null) {
    await deps.emailProviderEventRepository.finalize(tx, { eventId, state: "ignored", emailDeliveryId: null, now: input.now })
    return { outcome: "ignored", evidence: null, suppressed: false }
  }

  const classification = classifySesEvent(sesEvent)

  let delivery =
    classification.deliveryTag !== null && UUID_PATTERN.test(classification.deliveryTag)
      ? await deps.emailDeliveryRepository.lockById(tx, classification.deliveryTag)
      : null
  if (delivery === null) {
    delivery = await deps.emailDeliveryRepository.lockBySesMessageId(tx, classification.sesMessageId)
  }
  if (delivery === null) {
    await deps.emailProviderEventRepository.finalize(tx, { eventId, state: "unmatched", emailDeliveryId: null, now: input.now })
    return { outcome: "unmatched", evidence: null, suppressed: false }
  }

  if (classification.evidence !== null) {
    await deps.emailDeliveryRepository.applyEvidence(tx, {
      deliveryId: delivery.id,
      evidence: classification.evidence,
      now: input.now,
    })
  }
  if (classification.suppress !== null) {
    await deps.emailSuppressionRepository.suppress(tx, {
      recipientHmac: delivery.recipient_hmac,
      suppressionHmacKeyVersion: delivery.suppression_hmac_key_version,
      reason: classification.suppress,
      sourceEventId: eventId,
    })
  }
  await deps.emailProviderEventRepository.finalize(tx, {
    eventId,
    state: "processed",
    emailDeliveryId: delivery.id,
    now: input.now,
  })

  return { outcome: "processed", evidence: classification.evidence, suppressed: classification.suppress !== null }
}
