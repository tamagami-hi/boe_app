/**
 * beginPayment command (spec 03 §5.2 `beginPayment`, §6 "Begin payment"). Moves a
 * client purchase order from `submitted` to `payment_pending` and, in the same
 * transaction, creates the payment aggregate, its first attempt (attempt_number
 * 1), and a provider-call outbox event. The route wraps this in the idempotency
 * protocol. The actual provider network call is a later worker
 * (`sendPaymentToProvider`) that consumes the attempt and outbox event; it is
 * never performed inside this transaction.
 */
import type {
  InvestmentOrder,
  Payment,
  PaymentAttempt,
  Transaction,
} from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { PaymentWriteRepository } from "../../repositories/paymentRepository.js"

export interface BeginPaymentConfig {
  /** Payment gateway identifier stored on the attempt (placeholder until a live provider). */
  readonly paymentProvider: string
  /** Attempt authorization window; null disables an expiry. */
  readonly attemptTtlMs: number | null
}

export interface BeginPaymentDeps {
  readonly orderRepository: OrderWriteRepository
  readonly paymentRepository: PaymentWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
  readonly config: BeginPaymentConfig
}

export interface BeginPaymentInput {
  readonly userId: string
  readonly orderId: string
  readonly requestId: string
}

export interface BeginPaymentResult {
  readonly order: InvestmentOrder
  readonly payment: Payment
  readonly attempt: PaymentAttempt
}

export const beginPayment = async (
  tx: Transaction,
  deps: BeginPaymentDeps,
  input: BeginPaymentInput,
): Promise<BeginPaymentResult> => {
  const now = deps.clock()

  // Lock the order (owner-scoped). Missing/wrong-owner is 404; any non-submitted
  // or non-payable order fails the guarded transition below as STATE_CONFLICT.
  const locked = await deps.orderRepository.lockById(tx, { orderId: input.orderId, userId: input.userId })
  if (locked === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (locked.amount_paise === null) throw new AppError("STATE_CONFLICT")

  const order = await deps.orderRepository.beginPayment(tx, {
    orderId: input.orderId,
    userId: input.userId,
    now,
  })
  if (order === null) throw new AppError("STATE_CONFLICT")

  const { payment, attempt } = await deps.paymentRepository.createWithFirstAttempt(tx, {
    orderId: order.id,
    userId: input.userId,
    amountPaise: locked.amount_paise,
    currency: order.currency,
    provider: deps.config.paymentProvider,
    attemptExpiresAt: deps.config.attemptTtlMs === null ? null : new Date(now.getTime() + deps.config.attemptTtlMs),
  })

  await deps.outboxRepository.enqueue(tx, {
    topic: "payment",
    eventType: "payment.provider_call_requested",
    eventVersion: 1,
    aggregateType: "payment",
    aggregateId: payment.id,
    requestId: input.requestId,
    deduplicationKey: `payment_provider_call:${payment.id}:${attempt.attempt_number}`,
    payload: {
      paymentId: payment.id,
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      provider: deps.config.paymentProvider,
      amountPaise: locked.amount_paise,
      currency: order.currency,
    },
  })

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "order.begin_payment",
    entityType: "investment_order",
    entityId: order.id,
    fromState: "submitted",
    toState: "payment_pending",
    requestId: input.requestId,
    entityVersion: Number(order.version),
    metadata: { paymentId: payment.id },
  })

  return { order, payment, attempt }
}
