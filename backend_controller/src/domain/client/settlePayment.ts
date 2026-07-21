/**
 * Payment settlement worker (spec 03 §5.2, §6). This is the runtime trigger that
 * takes a `payment_pending` order through to `booked`: it drains the `payment`
 * provider-call outbox that `beginPayment` enqueues and, for each event, drives
 * the payment `send -> confirm -> book` chain.
 *
 * With the placeholder "manual" provider there is no external gateway, so the
 * "provider call" succeeds instantly inside the worker transaction. A real
 * gateway replaces `settleMockPayment` with a genuine async dispatch plus a
 * signed webhook that invokes `confirmPayment`; the outbox claim / lease / retry
 * choreography (mirroring the email delivery worker) stays the same.
 */
import type { UnitOfWork } from "../../db/database.js"
import type { OutboxEvent, Transaction } from "../../db/repositories.js"
import { isExhausted, nextRetryDelayMs } from "../../email/retrySchedule.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { HoldingWriteRepository } from "../../repositories/holdingRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { PaymentWriteRepository } from "../../repositories/paymentRepository.js"
import { bookOrder } from "./bookOrder.js"
import { confirmPayment, sendPaymentToProvider } from "./confirmPayment.js"

export interface SettleMockPaymentDeps {
  readonly paymentRepository: PaymentWriteRepository
  readonly orderRepository: OrderWriteRepository
  readonly holdingRepository: HoldingWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
  readonly config: { readonly paymentProvider: string }
}

export type SettleOutcome = "booked" | "already_booked"

/**
 * Drive a single payment forward to a booked order, tolerating partial progress
 * so a reprocessed event is idempotent. All steps run in the caller's
 * transaction (safe for the mock provider, which performs no external I/O).
 */
export const settleMockPayment = async (
  tx: Transaction,
  deps: SettleMockPaymentDeps,
  input: Readonly<{ paymentId: string; requestId: string }>,
): Promise<SettleOutcome> => {
  const payment = await deps.paymentRepository.findById(tx, input.paymentId)
  if (payment === null) throw new AppError("RESOURCE_NOT_FOUND")
  const orderId = payment.order_id
  const userId = payment.user_id

  const order = await deps.orderRepository.lockById(tx, { orderId, userId })
  if (order === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (order.state === "booked") return "already_booked"

  const seamDeps = {
    paymentRepository: deps.paymentRepository,
    orderRepository: deps.orderRepository,
    auditRepository: deps.auditRepository,
    clock: deps.clock,
  }
  const bookDeps = {
    orderRepository: deps.orderRepository,
    holdingRepository: deps.holdingRepository,
    notificationRepository: deps.notificationRepository,
    auditRepository: deps.auditRepository,
    clock: deps.clock,
  }

  if (order.state === "payment_pending") {
    if (payment.state === "created") {
      await sendPaymentToProvider(tx, seamDeps, {
        userId,
        orderId,
        providerPaymentId: `${deps.config.paymentProvider}:${payment.id}`,
        requestId: input.requestId,
      })
    }
    await confirmPayment(tx, seamDeps, {
      userId,
      orderId,
      evidenceAmountPaise: payment.amount_paise,
      evidenceCurrency: payment.currency,
      requestId: input.requestId,
    })
    await bookOrder(tx, bookDeps, { userId, orderId, requestId: input.requestId })
    return "booked"
  }

  if (order.state === "payment_confirmed") {
    await bookOrder(tx, bookDeps, { userId, orderId, requestId: input.requestId })
    return "booked"
  }

  // submitted (no payment yet) or a terminal failure state is not settleable.
  throw new AppError("STATE_CONFLICT")
}

export interface SettleDuePaymentsConfig {
  readonly topic: string
  readonly workerId: string
  readonly leaseMs: number
  readonly claimLimit: number
}

export interface SettleDuePaymentsDeps extends SettleMockPaymentDeps {
  readonly unitOfWork: UnitOfWork
  readonly outboxRepository: OutboxWriteRepository
  readonly settleConfig: SettleDuePaymentsConfig
}

export interface SettleSummary {
  readonly claimed: number
  readonly booked: number
  readonly alreadyBooked: number
  readonly retried: number
  readonly deadLettered: number
}

/**
 * One worker pass: recover expired leases, claim a bounded batch of due
 * `payment` provider-call events, and settle each. Mirrors the email delivery
 * worker's claim -> sending -> settle -> retry choreography; a failure reschedules
 * with backoff and dead-letters after the maximum attempts.
 */
export const settleDuePayments = async (deps: SettleDuePaymentsDeps): Promise<SettleSummary> => {
  const claimed = await deps.unitOfWork.execute(async (tx) => {
    const now = deps.clock()
    await deps.outboxRepository.recoverExpiredLeases(tx, { now })
    return deps.outboxRepository.claimDue(tx, {
      topic: deps.settleConfig.topic,
      workerId: deps.settleConfig.workerId,
      leaseMs: deps.settleConfig.leaseMs,
      limit: deps.settleConfig.claimLimit,
      now,
    })
  })

  const summary = { claimed: claimed.length, booked: 0, alreadyBooked: 0, retried: 0, deadLettered: 0 }

  for (const event of claimed) {
    // Commit the processing -> sending point of no return before settling.
    await deps.unitOfWork.execute((tx) =>
      deps.outboxRepository.markSending(tx, { outboxEventId: event.id, now: deps.clock() }),
    )
    try {
      const outcome = await deps.unitOfWork.execute(async (tx) => {
        const result = await settleMockPayment(tx, deps, {
          paymentId: event.aggregate_id,
          requestId: event.request_id,
        })
        await deps.outboxRepository.settleDelivered(tx, { outboxEventId: event.id, now: deps.clock() })
        return result
      })
      if (outcome === "booked") summary.booked += 1
      else summary.alreadyBooked += 1
    } catch (error) {
      await settleFailure(deps, event, error, summary)
    }
  }

  return summary
}

const settleFailure = async (
  deps: SettleDuePaymentsDeps,
  event: OutboxEvent,
  error: unknown,
  summary: { retried: number; deadLettered: number },
): Promise<void> => {
  const attempts = event.attempt_count + 1
  const errorCode = error instanceof AppError ? error.code : "PAYMENT_SETTLEMENT_ERROR"
  await deps.unitOfWork.execute(async (tx) => {
    const now = deps.clock()
    if (isExhausted(attempts)) {
      await deps.outboxRepository.deadLetter(tx, { outboxEventId: event.id, errorCode, now })
      summary.deadLettered += 1
    } else {
      const delayMs = nextRetryDelayMs(attempts, event.id) ?? 0
      await deps.outboxRepository.scheduleRetry(tx, {
        outboxEventId: event.id,
        availableAt: new Date(now.getTime() + delayMs),
        errorCode,
        now,
      })
      summary.retried += 1
    }
  })
}
