import { randomUUID } from "node:crypto"

import type { UnitOfWork } from "./db/database.js"
import { GatewayNotFoundError, type PaymentGateway } from "./providers/phonepe/paymentGateway.js"
import { logGatewayFailure, type GatewayFailureLogger } from "./providers/phonepe/gatewayFailure.js"
import type { PaymentsRepository } from "./repositories/paymentsRepository.js"
import type { RefundRepository } from "./repositories/refundRepository.js"

export interface PaymentReconciliationConfig {
  readonly claimLimit: number
  readonly notFoundGraceMs: number
}

export interface PaymentReconciliationDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly paymentGateway: PaymentGateway
  readonly paymentsRepository: PaymentsRepository
  readonly refundRepository: RefundRepository
  readonly logger: GatewayFailureLogger | null
  readonly config: PaymentReconciliationConfig
}

export interface ReconciliationSummary {
  readonly attemptsChecked: number
  readonly attemptsResolved: number
  readonly refundsChecked: number
  readonly refundsResolved: number
}

const expireAttempt = async (
  deps: PaymentReconciliationDeps,
  attemptId: string,
  paymentId: string,
  providerState: string,
): Promise<boolean> => {
  const now = deps.clock()
  return deps.unitOfWork.execute(async (tx) => {
    const attempt = await deps.paymentsRepository.markAttemptExpired(tx, { attemptId, providerState, now })
    if (attempt === null) return false
    await deps.paymentsRepository.markPaymentExpired(tx, paymentId, now)
    return true
  })
}

const reconcileAttempt = async (
  deps: PaymentReconciliationDeps,
  attemptId: string,
  paymentId: string,
  merchantOrderId: string,
  checkoutExpiresAt: Date | string | null,
): Promise<boolean> => {
  let outcome: "succeeded" | "failed" | "pending"
  let providerState = "UNKNOWN"
  let providerOrderId: string | null = null
  try {
    const fact = await deps.paymentGateway.getOrderStatus(merchantOrderId)
    outcome = fact.outcome
    providerState = fact.providerState
    providerOrderId = fact.providerOrderId
  } catch (error) {
    if (error instanceof GatewayNotFoundError) {
      const now = deps.clock()
      if (
        checkoutExpiresAt === null ||
        now.getTime() <= new Date(checkoutExpiresAt).getTime() + deps.config.notFoundGraceMs
      ) {
        await deps.unitOfWork.execute((tx) => deps.paymentsRepository.markAttemptStatusChecked(tx, { attemptId, now }))
        return false
      }
      return expireAttempt(deps, attemptId, paymentId, "NOT_FOUND")
    }
    logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "get_order_status" })
    return false
  }

  const now = deps.clock()
  return deps.unitOfWork.execute(async (tx) => {
    if (providerState === "EXPIRED") {
      const attempt = await deps.paymentsRepository.markAttemptExpired(tx, { attemptId, providerState, now })
      if (attempt === null) return false
      await deps.paymentsRepository.markPaymentExpired(tx, attempt.payment_id, now)
      return true
    }
    if (outcome === "succeeded") {
      const attempt = await deps.paymentsRepository.markAttemptSucceeded(tx, {
        attemptId,
        providerState,
        providerOrderId,
        now,
      })
      if (attempt === null) return false
      const payment = await deps.paymentsRepository.markPaymentSucceeded(tx, attempt.payment_id, now)
      if (payment === null) return false
      await deps.paymentsRepository.markOrderReviewPending(tx, payment.order_id, now)
      await deps.paymentsRepository.createPendingReview(tx, payment.order_id)
      return true
    }
    if (outcome === "failed") {
      const attempt = await deps.paymentsRepository.markAttemptFailed(tx, {
        attemptId,
        providerState,
        failureCode: "PROVIDER_DECLINED",
        now,
      })
      if (attempt === null) return false
      const payment = await deps.paymentsRepository.markPaymentFailed(tx, {
        paymentId: attempt.payment_id,
        failureCode: "PROVIDER_DECLINED",
        now,
      })
      if (payment === null) return false
      await deps.paymentsRepository.markOrderPaymentFailed(tx, {
        orderId: payment.order_id,
        failureCode: "PROVIDER_DECLINED",
        now,
      })
      return true
    }
    await deps.paymentsRepository.markAttemptStatusChecked(tx, { attemptId, now })
    return false
  })
}

const reconcileRefund = async (
  deps: PaymentReconciliationDeps,
  refundId: string,
  merchantRefundId: string,
  paymentId: string,
  orderId: string,
  amountPaise: string,
  state: string,
): Promise<boolean> => {
  if (state === "pending") {
    const attempt = await deps.unitOfWork.execute((tx) =>
      deps.paymentsRepository.latestAttempt(tx, paymentId),
    )
    if (attempt === null || attempt.state !== "succeeded") return false

    let providerRefundId: string | null = null
    let outcome: "succeeded" | "failed" | "pending" = "pending"
    try {
      const initiated = await deps.paymentGateway.initiateRefund({
        merchantRefundId,
        originalMerchantOrderId: attempt.merchant_order_id,
        amountPaise,
      })
      providerRefundId = initiated.providerRefundId
      outcome = initiated.outcome
    } catch (error) {
      logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "initiate_refund" })
      return false
    }
    const now = deps.clock()
    return deps.unitOfWork.execute(async (tx) => {
      await deps.refundRepository.markProviderPending(tx, { refundId, providerRefundId, now })
      if (outcome === "succeeded") {
        const refunded = await deps.refundRepository.markRefunded(tx, { refundId, providerRefundId, now })
        if (refunded === null) return false
        await deps.paymentsRepository.markPaymentRefunded(tx, paymentId, now)
        await deps.paymentsRepository.markOrderRefunded(tx, orderId, now)
        return true
      }
      return false
    })
  }

  let outcome: "succeeded" | "failed" | "pending"
  try {
    const fact = await deps.paymentGateway.getRefundStatus(merchantRefundId)
    outcome = fact.outcome
  } catch (error) {
    logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "get_refund_status" })
    return false
  }

  const now = deps.clock()
  return deps.unitOfWork.execute(async (tx) => {
    if (outcome === "succeeded") {
      const refunded = await deps.refundRepository.markRefunded(tx, { refundId, providerRefundId: null, now })
      if (refunded === null) return false
      await deps.paymentsRepository.markPaymentRefunded(tx, paymentId, now)
      await deps.paymentsRepository.markOrderRefunded(tx, orderId, now)
      return true
    }
    if (outcome === "failed") {
      const failed = await deps.refundRepository.markFailed(tx, {
        refundId,
        failureCode: "PROVIDER_REFUND_FAILED",
        now,
      })
      if (failed === null) return false
      await deps.paymentsRepository.markPaymentRefundFailed(tx, paymentId, now)
      await deps.paymentsRepository.markOrderRefundFailed(tx, {
        orderId,
        failureCode: "PROVIDER_REFUND_FAILED",
        now,
      })
      return true
    }
    await deps.refundRepository.markStatusChecked(tx, { refundId, now })
    return false
  })
}

export const runReconciliationPass = async (
  deps: PaymentReconciliationDeps,
): Promise<ReconciliationSummary> => {
  const now = deps.clock()
  const attempts = await deps.unitOfWork.execute((tx) =>
    deps.paymentsRepository.lockAttemptsForReconciliation(tx, {
      limit: deps.config.claimLimit,
      createdDueBefore: new Date(now.getTime() - deps.config.notFoundGraceMs),
    }),
  )

  let attemptsResolved = 0
  for (const attempt of attempts) {
    const resolved = await reconcileAttempt(
      deps,
      attempt.id,
      attempt.payment_id,
      attempt.merchant_order_id,
      attempt.checkout_expires_at,
    )
    if (resolved) attemptsResolved += 1
  }

  const refunds = await deps.unitOfWork.execute((tx) =>
    deps.refundRepository.lockDueRefunds(tx, { limit: deps.config.claimLimit }),
  )

  let refundsResolved = 0
  for (const refund of refunds) {
    const resolved = await reconcileRefund(
      deps,
      refund.id,
      refund.merchant_refund_id,
      refund.payment_id,
      refund.order_id,
      refund.amount_paise,
      refund.state,
    )
    if (resolved) refundsResolved += 1
  }

  return {
    attemptsChecked: attempts.length,
    attemptsResolved,
    refundsChecked: refunds.length,
    refundsResolved,
  }
}
