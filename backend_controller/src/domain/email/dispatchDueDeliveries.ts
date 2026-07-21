/**
 * Email delivery worker command (spec 04 §6.2). One pass: recover expired
 * leases, claim due outbox rows, and for each one run the documented
 * claim -> sending -> SES -> settle choreography.
 *
 * The committed `sending` transition is the point of no return; SES is called
 * only after it commits and strictly outside any transaction, and the result is
 * recorded in a fresh transaction. A lost SES response leaves the lease to
 * expire (a duplicate message with the same still-valid link may be sent, but
 * domain state is never duplicated). Revoked or suppressed work is cancelled
 * before sending. `email_deliveries` never owns the claim or retry schedule.
 */
import type { CryptoContext } from "../../crypto/context.js"
import type { UnitOfWork } from "../../db/database.js"
import type { OutboxEvent } from "../../db/repositories.js"
import { isExhausted, nextRetryDelayMs } from "../../email/retrySchedule.js"
import type { SesEmailSender, SesSendResult } from "../../email/ports.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { EmailSuppressionWriteRepository } from "../../repositories/emailSuppressionRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"

export interface DispatchConfig {
  readonly topic: string
  readonly workerId: string
  readonly leaseMs: number
  readonly claimLimit: number
}

export interface DispatchDeps {
  readonly unitOfWork: UnitOfWork
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly emailSuppressionRepository: EmailSuppressionWriteRepository
  readonly sender: SesEmailSender
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: DispatchConfig
}

export interface DispatchSummary {
  readonly claimed: number
  readonly sent: number
  readonly retried: number
  readonly deadLettered: number
  readonly cancelled: number
  readonly skipped: number
}

type PreparedSend =
  | { readonly kind: "ready"; readonly deliveryId: string; readonly recipient: string; readonly templateKey: string; readonly templateVersion: string; readonly configurationSet: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "skipped" }

// Lock the delivery + outbox, validate, and either cancel obsolete work or
// commit both to `sending`. Returns what SES should be called with, if anything.
const prepare = async (deps: DispatchDeps, event: OutboxEvent): Promise<PreparedSend> =>
  deps.unitOfWork.execute(async (tx) => {
    const now = deps.clock()
    const delivery = await deps.emailDeliveryRepository.lockByOutboxEventId(tx, event.id)

    if (delivery === null || delivery.recipient_ciphertext === null || delivery.recipient_nonce === null) {
      // No sendable delivery for this event: release it terminally so it is not
      // reclaimed. This is a structural no-op, not a delivery.
      await deps.outboxRepository.cancel(tx, { outboxEventId: event.id, now })
      return { kind: "skipped" }
    }

    const suppression = await deps.emailSuppressionRepository.findActive(tx, {
      recipientHmac: delivery.recipient_hmac,
      suppressionHmacKeyVersion: delivery.suppression_hmac_key_version,
    })
    const isSendable = delivery.state === "queued" || delivery.state === "retryable_failed"
    if (suppression !== null || !isSendable) {
      await deps.emailDeliveryRepository.cancel(tx, { deliveryId: delivery.id, now })
      await deps.outboxRepository.cancel(tx, { outboxEventId: event.id, now })
      return { kind: "cancelled" }
    }

    await deps.emailDeliveryRepository.transitionSending(tx, { deliveryId: delivery.id, now })
    await deps.outboxRepository.markSending(tx, { outboxEventId: event.id, now })

    return {
      kind: "ready",
      deliveryId: delivery.id,
      recipient: deps.crypto.decryptRecipient(delivery.recipient_ciphertext, delivery.recipient_nonce),
      templateKey: delivery.template_key,
      templateVersion: delivery.template_version,
      configurationSet: delivery.ses_configuration_set,
    }
  })

const callSes = async (deps: DispatchDeps, prepared: Extract<PreparedSend, { kind: "ready" }>): Promise<SesSendResult> => {
  try {
    return await deps.sender.send({
      deliveryId: prepared.deliveryId,
      toAddress: prepared.recipient,
      templateKey: prepared.templateKey,
      templateVersion: prepared.templateVersion,
      configurationSet: prepared.configurationSet,
    })
  } catch {
    // A thrown transport error is retryable; the settle transaction reschedules.
    return { outcome: "rejected", disposition: "retryable", errorCode: "SES_TRANSPORT_ERROR" }
  }
}

type SettleOutcome = "sent" | "retried" | "deadLettered"

const settle = async (
  deps: DispatchDeps,
  event: OutboxEvent,
  deliveryId: string,
  result: SesSendResult,
): Promise<SettleOutcome> => {
  const attempts = event.attempt_count + 1
  const now = deps.clock()

  if (result.outcome === "accepted") {
    await deps.unitOfWork.execute(async (tx) => {
      await deps.emailDeliveryRepository.recordSent(tx, {
        deliveryId,
        sesMessageId: result.sesMessageId,
        sesRequestId: result.sesRequestId,
        now,
      })
      await deps.outboxRepository.settleDelivered(tx, { outboxEventId: event.id, now })
    })
    return "sent"
  }

  const terminal = result.disposition === "permanent" || isExhausted(attempts)
  await deps.unitOfWork.execute(async (tx) => {
    await deps.emailDeliveryRepository.recordSendFailure(tx, {
      deliveryId,
      errorCode: result.errorCode,
      permanent: terminal,
      now,
    })
    if (terminal) {
      await deps.outboxRepository.deadLetter(tx, { outboxEventId: event.id, errorCode: result.errorCode, now })
    } else {
      const delayMs = nextRetryDelayMs(attempts, event.id) ?? 0
      await deps.outboxRepository.scheduleRetry(tx, {
        outboxEventId: event.id,
        availableAt: new Date(now.getTime() + delayMs),
        errorCode: result.errorCode,
        now,
      })
    }
  })
  return terminal ? "deadLettered" : "retried"
}

export const dispatchDueDeliveries = async (deps: DispatchDeps): Promise<DispatchSummary> => {
  const now = deps.clock()
  const claimed = await deps.unitOfWork.execute(async (tx) => {
    await deps.outboxRepository.recoverExpiredLeases(tx, { now })
    return deps.outboxRepository.claimDue(tx, {
      topic: deps.config.topic,
      workerId: deps.config.workerId,
      leaseMs: deps.config.leaseMs,
      limit: deps.config.claimLimit,
      now,
    })
  })

  const summary = { claimed: claimed.length, sent: 0, retried: 0, deadLettered: 0, cancelled: 0, skipped: 0 }

  for (const event of claimed) {
    const prepared = await prepare(deps, event)
    if (prepared.kind === "cancelled") {
      summary.cancelled += 1
      continue
    }
    if (prepared.kind === "skipped") {
      summary.skipped += 1
      continue
    }
    const result = await callSes(deps, prepared)
    const outcome = await settle(deps, event, prepared.deliveryId, result)
    if (outcome === "sent") summary.sent += 1
    else if (outcome === "retried") summary.retried += 1
    else summary.deadLettered += 1
  }

  return summary
}
