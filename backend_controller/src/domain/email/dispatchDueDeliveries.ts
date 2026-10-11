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
import type { EmailDelivery, OutboxEvent, Transaction } from "../../db/repositories.js"
import { isExhausted, nextRetryDelayMs } from "../../email/retrySchedule.js"
import type { SesEmailSender, SesSendResult } from "../../email/ports.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { EmailSuppressionWriteRepository } from "../../repositories/emailSuppressionRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import { openSealedPayload } from "./openSealedPayload.js"
import { recoverExpiredDeliveries } from "./recoverExpiredDeliveries.js"

export interface DispatchConfig {
  readonly topics: readonly string[]
  readonly workerId: string
  readonly leaseMs: number
  readonly claimLimit: number
  readonly messageBudgetMs: number
  readonly passBudgetMs: number
}

export interface SendGuardContext {
  readonly event: OutboxEvent
  readonly delivery: EmailDelivery
  readonly now: Date
}

export type SendVerdict =
  | { readonly kind: "send" }
  | { readonly kind: "cancel"; readonly reason: string }

export type SendGuard = (tx: Transaction, context: SendGuardContext) => Promise<SendVerdict>

export interface DispatchDeps {
  readonly unitOfWork: UnitOfWork
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly emailSuppressionRepository: EmailSuppressionWriteRepository
  readonly sender: SesEmailSender
  readonly crypto: CryptoContext
  readonly sendGuards: ReadonlyMap<string, SendGuard>
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
  readonly superseded: number
  readonly recovered: number
}

type PreparedSend =
  | {
      readonly kind: "ready"
      readonly deliveryId: string
      readonly recipient: string
      readonly templateKey: string
      readonly templateVersion: string
      readonly configurationSet: string
      readonly templateData: Readonly<Record<string, unknown>>
    }
  | { readonly kind: "unsendable"; readonly deliveryId: string; readonly errorCode: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "skipped" }
  | { readonly kind: "superseded" }

/** The enqueued payload, which carries the token the message needs. */
const templateDataOf = (event: OutboxEvent): Readonly<Record<string, unknown>> => {
  const payload: unknown = event.payload
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {}
}

const RECIPIENT_UNREADABLE_ERROR_CODE = "EMAIL_RECIPIENT_UNREADABLE"

const openRecipient = (crypto: CryptoContext, ciphertext: Buffer, nonce: Buffer): string | null => {
  try {
    return crypto.decryptRecipient(ciphertext, nonce)
  } catch {
    return null
  }
}

const verdictFor = (deps: DispatchDeps, tx: Transaction, context: SendGuardContext): Promise<SendVerdict> => {
  const guard = deps.sendGuards.get(context.delivery.template_key)
  return guard === undefined ? Promise.resolve({ kind: "send" }) : guard(tx, context)
}

// Lock the delivery + outbox, validate, and either cancel obsolete work or
// commit both to `sending`. Returns what SES should be called with, if anything.
const prepare = async (deps: DispatchDeps, event: OutboxEvent): Promise<PreparedSend> =>
  deps.unitOfWork.execute(async (tx) => {
    const now = deps.clock()
    const claim = { outboxEventId: event.id, generation: event.lease_generation }
    const delivery = await deps.emailDeliveryRepository.lockByOutboxEventId(tx, event.id)

    if (delivery === null || delivery.recipient_ciphertext === null || delivery.recipient_nonce === null) {
      if (await deps.outboxRepository.cancelUnsent(tx, { ...claim, now })) {
        return { kind: delivery === null ? "skipped" : "cancelled" }
      }
      const owned = await deps.outboxRepository.cancel(tx, { ...claim, now })
      return { kind: owned ? "skipped" : "superseded" }
    }

    if (delivery.state === "sending") {
      const owned = await deps.outboxRepository.release(tx, { ...claim, now })
      return { kind: owned ? "skipped" : "superseded" }
    }

    const suppression = await deps.emailSuppressionRepository.findActive(tx, {
      recipientHmac: delivery.recipient_hmac,
      suppressionHmacKeyVersion: delivery.suppression_hmac_key_version,
    })
    const isSendable = delivery.state === "queued" || delivery.state === "retryable_failed"
    if (suppression !== null || !isSendable) {
      const owned = await deps.outboxRepository.cancel(tx, { ...claim, now })
      if (!owned) return { kind: "superseded" }
      await deps.emailDeliveryRepository.cancel(tx, { deliveryId: delivery.id, now })
      return { kind: "cancelled" }
    }

    const verdict = await verdictFor(deps, tx, { event, delivery, now })
    if (verdict.kind === "cancel") {
      const cancelled = await deps.outboxRepository.cancelUnsent(tx, { ...claim, now })
      return { kind: cancelled ? "cancelled" : "superseded" }
    }

    const started = await deps.outboxRepository.markSending(tx, { ...claim, workerId: deps.config.workerId, now })
    if (!started) return { kind: "superseded" }
    await deps.emailDeliveryRepository.transitionSending(tx, { deliveryId: delivery.id, now })

    const sealed = await openSealedPayload(deps, tx, event, delivery.id)
    if (sealed.kind === "failed") return { kind: "unsendable", deliveryId: delivery.id, errorCode: sealed.errorCode }

    const recipient = openRecipient(deps.crypto, delivery.recipient_ciphertext, delivery.recipient_nonce)
    if (recipient === null) {
      return { kind: "unsendable", deliveryId: delivery.id, errorCode: RECIPIENT_UNREADABLE_ERROR_CODE }
    }

    return {
      kind: "ready",
      deliveryId: delivery.id,
      recipient,
      templateKey: delivery.template_key,
      templateVersion: delivery.template_version,
      configurationSet: delivery.ses_configuration_set,
      templateData: { ...templateDataOf(event), ...sealed.data },
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
      templateData: prepared.templateData,
    })
  } catch {
    // A thrown transport error is retryable; the settle transaction reschedules.
    return { outcome: "rejected", disposition: "retryable", errorCode: "SES_TRANSPORT_ERROR" }
  }
}

type SettleOutcome = "sent" | "retried" | "deadLettered" | "superseded"

const settle = async (
  deps: DispatchDeps,
  event: OutboxEvent,
  deliveryId: string,
  result: SesSendResult,
): Promise<SettleOutcome> => {
  const claim = { outboxEventId: event.id, generation: event.lease_generation }
  const attempts = event.attempt_count + 1
  const now = deps.clock()

  if (result.outcome === "accepted") {
    return deps.unitOfWork.execute(async (tx) => {
      await deps.emailDeliveryRepository.lockByOutboxEventId(tx, event.id)
      const owned = await deps.outboxRepository.settleDelivered(tx, { ...claim, now })
      if (owned) {
        await deps.emailDeliveryRepository.recordSent(tx, {
          deliveryId,
          sesMessageId: result.sesMessageId,
          sesRequestId: result.sesRequestId,
          now,
        })
      }
      await deps.outboxRepository.recordAttemptResult(tx, {
        ...claim,
        outcome: "accepted",
        errorCode: null,
        messageId: result.sesMessageId,
        now,
      })
      return owned ? "sent" : "superseded"
    })
  }

  const terminal = result.disposition === "permanent" || isExhausted(attempts)
  return deps.unitOfWork.execute(async (tx) => {
    await deps.emailDeliveryRepository.lockByOutboxEventId(tx, event.id)
    const owned = terminal
      ? await deps.outboxRepository.deadLetter(tx, { ...claim, errorCode: result.errorCode, now })
      : await deps.outboxRepository.scheduleRetry(tx, {
          ...claim,
          availableAt: new Date(now.getTime() + (nextRetryDelayMs(attempts, event.id) ?? 0)),
          errorCode: result.errorCode,
          now,
        })
    if (owned) {
      await deps.emailDeliveryRepository.recordSendFailure(tx, {
        deliveryId,
        errorCode: result.errorCode,
        permanent: terminal,
        now,
      })
    }
    await deps.outboxRepository.recordAttemptResult(tx, {
      ...claim,
      outcome: result.disposition,
      errorCode: result.errorCode,
      messageId: null,
      now,
    })
    if (!owned) return "superseded"
    return terminal ? "deadLettered" : "retried"
  })
}

const claimNext = (deps: DispatchDeps): Promise<OutboxEvent | null> =>
  deps.unitOfWork.execute(async (tx) => {
    const claimed = await deps.outboxRepository.claimDue(tx, {
      topics: deps.config.topics,
      workerId: deps.config.workerId,
      leaseMs: deps.config.leaseMs,
      limit: 1,
      now: deps.clock(),
    })
    return claimed[0] ?? null
  })

const hasTimeForAnotherMessage = (deps: DispatchDeps, passStartedAtMs: number, claimed: number): boolean =>
  claimed === 0 || deps.clock().getTime() - passStartedAtMs + deps.config.messageBudgetMs <= deps.config.passBudgetMs

export const dispatchDueDeliveries = async (deps: DispatchDeps): Promise<DispatchSummary> => {
  const passStartedAtMs = deps.clock().getTime()
  const summary = { claimed: 0, sent: 0, retried: 0, deadLettered: 0, cancelled: 0, skipped: 0, superseded: 0, recovered: 0 }

  summary.recovered = await recoverExpiredDeliveries({
    unitOfWork: deps.unitOfWork,
    outboxRepository: deps.outboxRepository,
    emailDeliveryRepository: deps.emailDeliveryRepository,
    clock: deps.clock,
    batchLimit: deps.config.claimLimit,
  })

  while (summary.claimed < deps.config.claimLimit && hasTimeForAnotherMessage(deps, passStartedAtMs, summary.claimed)) {
    const event = await claimNext(deps)
    if (event === null) break
    summary.claimed += 1

    const prepared = await prepare(deps, event)
    if (prepared.kind === "cancelled") {
      summary.cancelled += 1
      continue
    }
    if (prepared.kind === "skipped") {
      summary.skipped += 1
      continue
    }
    if (prepared.kind === "superseded") {
      summary.superseded += 1
      continue
    }
    if (prepared.kind === "unsendable") {
      const unsent = await settle(deps, event, prepared.deliveryId, {
        outcome: "rejected",
        disposition: "permanent",
        errorCode: prepared.errorCode,
      })
      summary[unsent] += 1
      continue
    }
    const result = await callSes(deps, prepared)
    const outcome = await settle(deps, event, prepared.deliveryId, result)
    summary[outcome] += 1
  }

  return summary
}
