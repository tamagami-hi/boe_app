/**
 * Payment settlement (spec 03 §5.2, §6). Two runtime paths share one forward
 * driver:
 *
 *  - The **mock provider** (`manual`): the settlement worker drains the `payment`
 *    provider-call outbox and drives each payment all the way to `booked`
 *    (instant success, no external I/O).
 *  - A **real gateway**: the worker only *dispatches* (`created ->
 *    provider_pending`); the paid/failed confirmation arrives later on the signed
 *    payment webhook, which calls `recordPaymentResult`.
 *
 * `advancePaymentToBooked` is the provider-agnostic forward driver used by both
 * the mock worker pass and a successful webhook; it is idempotent across partial
 * progress. The outbox claim / lease / retry choreography mirrors the email
 * delivery worker.
 */
import type { UnitOfWork } from "../../db/database.js"
import type { OutboxEvent, Transaction } from "../../db/repositories.js"
import { isExhausted, nextRetryDelayMs } from "../../email/retrySchedule.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { InvestorLedgerRepository } from "../../repositories/investorLedgerRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { PaymentWriteRepository } from "../../repositories/paymentRepository.js"
import { bookOrder } from "./bookOrder.js"
import { confirmPayment, failPayment, sendPaymentToProvider } from "./confirmPayment.js"

export interface AdvancePaymentDeps {
  readonly paymentRepository: PaymentWriteRepository
  readonly orderRepository: OrderWriteRepository
  readonly investorLedgerRepository: InvestorLedgerRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
  readonly config: { readonly paymentProvider: string }
}

const seamDepsOf = (deps: AdvancePaymentDeps) => ({
  paymentRepository: deps.paymentRepository,
  orderRepository: deps.orderRepository,
  auditRepository: deps.auditRepository,
  clock: deps.clock,
})

const bookDepsOf = (deps: AdvancePaymentDeps) => ({
  orderRepository: deps.orderRepository,
  investorLedgerRepository: deps.investorLedgerRepository,
  notificationRepository: deps.notificationRepository,
  auditRepository: deps.auditRepository,
  clock: deps.clock,
})

export type AdvanceOutcome = "booked" | "already_booked"

/**
 * Drive a single payment forward to a booked order, tolerating partial progress
 * so a reprocessed event is idempotent. All steps run in the caller's
 * transaction.
 */
export const advancePaymentToBooked = async (
  tx: Transaction,
  deps: AdvancePaymentDeps,
  input: Readonly<{ paymentId: string; requestId: string }>,
): Promise<AdvanceOutcome> => {
  const payment = await deps.paymentRepository.findById(tx, input.paymentId)
  if (payment === null) throw new AppError("RESOURCE_NOT_FOUND")
  const { order_id: orderId, user_id: userId } = payment

  const order = await deps.orderRepository.lockById(tx, { orderId, userId })
  if (order === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (order.state === "booked") return "already_booked"

  if (order.state === "payment_pending") {
    if (payment.state === "created") {
      await sendPaymentToProvider(tx, seamDepsOf(deps), {
        userId,
        orderId,
        providerPaymentId: `${deps.config.paymentProvider}:${payment.id}`,
        requestId: input.requestId,
      })
    }
    await confirmPayment(tx, seamDepsOf(deps), {
      userId,
      orderId,
      evidenceAmountPaise: payment.amount_paise,
      evidenceCurrency: payment.currency,
      requestId: input.requestId,
    })
    await bookOrder(tx, bookDepsOf(deps), {
      userId,
      orderId,
      requestId: input.requestId,
      paymentId: input.paymentId,
    })
    return "booked"
  }

  if (order.state === "payment_confirmed") {
    await bookOrder(tx, bookDepsOf(deps), {
      userId,
      orderId,
      requestId: input.requestId,
      paymentId: input.paymentId,
    })
    return "booked"
  }

  throw new AppError("STATE_CONFLICT")
}

/** Dispatch-only step for a real gateway: created -> provider_pending. */
export const dispatchPayment = async (
  tx: Transaction,
  deps: AdvancePaymentDeps,
  input: Readonly<{ paymentId: string; requestId: string }>,
): Promise<void> => {
  const payment = await deps.paymentRepository.findById(tx, input.paymentId)
  if (payment === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (payment.state !== "created") return // already dispatched
  await sendPaymentToProvider(tx, seamDepsOf(deps), {
    userId: payment.user_id,
    orderId: payment.order_id,
    providerPaymentId: `${deps.config.paymentProvider}:${payment.id}`,
    requestId: input.requestId,
  })
}

export type PaymentResultStatus = "succeeded" | "failed"
export type PaymentResultOutcome = "booked" | "failed" | "already_booked" | "already_failed"

/**
 * Record a provider confirmation (the paid/not-paid checkpoint), invoked by the
 * signed payment webhook. Idempotent: a terminal order is a no-op.
 */
export const recordPaymentResult = async (
  tx: Transaction,
  deps: AdvancePaymentDeps,
  input: Readonly<{ paymentId: string; status: PaymentResultStatus; failureCode?: string; requestId: string }>,
): Promise<PaymentResultOutcome> => {
  const payment = await deps.paymentRepository.findById(tx, input.paymentId)
  if (payment === null) throw new AppError("RESOURCE_NOT_FOUND")
  const order = await deps.orderRepository.lockById(tx, {
    orderId: payment.order_id,
    userId: payment.user_id,
  })
  if (order === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (order.state === "booked") return "already_booked"
  if (order.state === "payment_failed") return "already_failed"

  if (input.status === "succeeded") {
    await advancePaymentToBooked(tx, deps, { paymentId: input.paymentId, requestId: input.requestId })
    return "booked"
  }
  await failPayment(tx, seamDepsOf(deps), {
    userId: payment.user_id,
    orderId: payment.order_id,
    failureCode: input.failureCode ?? "PROVIDER_FAILED",
    requestId: input.requestId,
  })
  return "failed"
}

export interface SettleDuePaymentsConfig {
  readonly topic: string
  readonly workerId: string
  readonly leaseMs: number
  readonly claimLimit: number
  /** Mock provider: settle to booked in the pass. Real gateway: dispatch only. */
  readonly autoConfirm: boolean
}

export interface SettleDuePaymentsDeps extends AdvancePaymentDeps {
  readonly unitOfWork: UnitOfWork
  readonly outboxRepository: OutboxWriteRepository
  readonly settleConfig: SettleDuePaymentsConfig
}

export interface SettleSummary {
  readonly claimed: number
  readonly booked: number
  readonly dispatched: number
  readonly alreadyBooked: number
  readonly retried: number
  readonly deadLettered: number
}

/**
 * One worker pass: recover expired leases, claim a bounded batch of due
 * `payment` provider-call events, and either settle them to booked (mock
 * provider) or dispatch them to the gateway (real provider).
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

  const summary = { claimed: claimed.length, booked: 0, dispatched: 0, alreadyBooked: 0, retried: 0, deadLettered: 0 }

  for (const event of claimed) {
    await deps.unitOfWork.execute((tx) =>
      deps.outboxRepository.markSending(tx, { outboxEventId: event.id, now: deps.clock() }),
    )
    try {
      await deps.unitOfWork.execute(async (tx) => {
        if (deps.settleConfig.autoConfirm) {
          const outcome = await advancePaymentToBooked(tx, deps, {
            paymentId: event.aggregate_id,
            requestId: event.request_id,
          })
          if (outcome === "booked") summary.booked += 1
          else summary.alreadyBooked += 1
        } else {
          await dispatchPayment(tx, deps, { paymentId: event.aggregate_id, requestId: event.request_id })
          summary.dispatched += 1
        }
        await deps.outboxRepository.settleDelivered(tx, { outboxEventId: event.id, now: deps.clock() })
      })
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
