/**
 * Payment provider seam (spec 03 §5.2 `sendPaymentToProvider`, `succeedPayment`,
 * `confirmPayment`; §6). These are system/provider-driven commands, not client
 * routes: a real deployment invokes them from the payment sender worker and the
 * signed provider webhook. They are built now as verified transactional domain
 * commands (exercised by integration tests) so order booking has a reachable,
 * spec-faithful predecessor state. Signature verification and the running worker
 * that consumes the `payment` provider-call outbox are deferred.
 *
 *   sendPaymentToProvider: payment created -> provider_pending (dispatch)
 *   confirmPayment:        payment provider_pending -> succeeded, order
 *                          payment_pending -> payment_confirmed (provider success)
 */
import type { InvestmentOrder, Payment, Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"
import type { PaymentWriteRepository } from "../../repositories/paymentRepository.js"

export interface PaymentSeamDeps {
  readonly paymentRepository: PaymentWriteRepository
  readonly orderRepository: OrderWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface SendPaymentToProviderInput {
  readonly userId: string
  readonly orderId: string
  readonly providerPaymentId: string
  readonly requestId: string
}

/** Dispatch the payment to the provider: created -> provider_pending. */
export const sendPaymentToProvider = async (
  tx: Transaction,
  deps: PaymentSeamDeps,
  input: SendPaymentToProviderInput,
): Promise<Payment> => {
  const now = deps.clock()
  const locked = await deps.paymentRepository.lockByOrder(tx, { orderId: input.orderId, userId: input.userId })
  if (locked === null) throw new AppError("RESOURCE_NOT_FOUND")

  const payment = await deps.paymentRepository.sendToProvider(tx, {
    paymentId: locked.id,
    userId: input.userId,
    providerPaymentId: input.providerPaymentId,
    now,
  })
  if (payment === null) throw new AppError("STATE_CONFLICT")

  await deps.auditRepository.append(tx, {
    actorType: "system",
    command: "payment.send_to_provider",
    entityType: "payment",
    entityId: payment.id,
    fromState: "created",
    toState: "provider_pending",
    requestId: input.requestId,
    entityVersion: Number(payment.version),
    metadata: { orderId: input.orderId },
  })
  return payment
}

export interface ConfirmPaymentInput {
  readonly userId: string
  readonly orderId: string
  /** Provider evidence: the amount/currency the provider reports as succeeded. */
  readonly evidenceAmountPaise: string
  readonly evidenceCurrency: string
  readonly requestId: string
}

export interface ConfirmPaymentResult {
  readonly order: InvestmentOrder
  readonly payment: Payment
}

/**
 * Record a successful provider result: the payment succeeds and the order moves
 * to payment_confirmed atomically. The provider evidence must match the payment
 * amount/currency, or the result is rejected as a stale/mismatched prerequisite.
 */
export const confirmPayment = async (
  tx: Transaction,
  deps: PaymentSeamDeps,
  input: ConfirmPaymentInput,
): Promise<ConfirmPaymentResult> => {
  const now = deps.clock()
  const locked = await deps.paymentRepository.lockByOrder(tx, { orderId: input.orderId, userId: input.userId })
  if (locked === null) throw new AppError("RESOURCE_NOT_FOUND")

  // Provider evidence must match the recorded payment amount and currency.
  if (BigInt(locked.amount_paise) !== BigInt(input.evidenceAmountPaise) || locked.currency !== input.evidenceCurrency) {
    throw new AppError("STATE_CONFLICT")
  }

  const payment = await deps.paymentRepository.succeed(tx, { paymentId: locked.id, userId: input.userId, now })
  if (payment === null) throw new AppError("STATE_CONFLICT")

  const order = await deps.orderRepository.confirmPayment(tx, {
    orderId: input.orderId,
    userId: input.userId,
    now,
  })
  if (order === null) throw new AppError("STATE_CONFLICT")

  await deps.auditRepository.append(tx, {
    actorType: "provider",
    command: "order.confirm_payment",
    entityType: "investment_order",
    entityId: order.id,
    fromState: "payment_pending",
    toState: "payment_confirmed",
    requestId: input.requestId,
    entityVersion: Number(order.version),
    metadata: { paymentId: payment.id },
  })
  return { order, payment }
}
