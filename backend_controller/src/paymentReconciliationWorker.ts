import { randomUUID } from "node:crypto"

import type { UnitOfWork } from "./db/database.js"
import { applyCanonicalPaymentOutcome } from "./domain/payments/applyCanonicalPaymentOutcome.js"
import { isRefundEvidenceCorrelated } from "./domain/payments/refundEvidence.js"
import {
  GatewayMalformedResponseError,
  GatewayNotFoundError,
  GatewayThrottledError,
  type PaymentGateway,
} from "./providers/phonepe/paymentGateway.js"
import { logGatewayFailure, type GatewayFailureLogger } from "./providers/phonepe/gatewayFailure.js"
import type { PaymentsRepository } from "./repositories/paymentsRepository.js"
import type { InvestmentSettlementRepository } from "./repositories/investmentSettlementRepository.js"
import type { RefundRepository } from "./repositories/refundRepository.js"

export interface PaymentReconciliationConfig {
  readonly claimLimit: number
  readonly notFoundGraceMs: number
  readonly leaseMs?: number
  readonly pendingIntervalMs?: number
  readonly maxBackoffMs?: number
}

export interface PaymentReconciliationDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly paymentGateway: PaymentGateway
  readonly paymentsRepository: PaymentsRepository
  readonly settlementRepository: InvestmentSettlementRepository
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
    const payment = await deps.paymentsRepository.lockPaymentById(tx, paymentId)
    if (payment === null) return false
    if (payment.succeeded_at !== null) {
      await deps.paymentsRepository.markReconciliationRequired(tx, {
        attemptId,
        paymentId,
        providerState,
        now,
      })
      return true
    }
    const attempt = await deps.paymentsRepository.markAttemptExpired(tx, { attemptId, providerState, now })
    if (attempt === null) return false
    if (await deps.paymentsRepository.markPaymentExpired(tx, paymentId, now) === null) {
      throw new Error("payment expiry transition failed")
    }
    return true
  })
}

const reconcileAttempt = async (
  deps: PaymentReconciliationDeps,
  attemptId: string,
  paymentId: string,
  merchantOrderId: string,
  checkoutExpiresAt: Date | string | null,
  failureCount: number,
): Promise<boolean> => {
  const pendingIntervalMs = deps.config.pendingIntervalMs ?? 0
  const maxBackoffMs = deps.config.maxBackoffMs ?? 900_000
  let fact
  let providerState = "UNKNOWN"
  try {
    fact = await deps.paymentGateway.getOrderStatus(merchantOrderId)
    providerState = fact.providerState
  } catch (error) {
    if (error instanceof GatewayNotFoundError) {
      const now = deps.clock()
      if (
        checkoutExpiresAt === null ||
        now.getTime() <= new Date(checkoutExpiresAt).getTime() + deps.config.notFoundGraceMs
      ) {
        await deps.unitOfWork.execute((tx) => deps.paymentsRepository.rescheduleAttemptReconciliation(tx, {
          attemptId,
          now,
          nextCheckAt: new Date(now.getTime() + pendingIntervalMs),
          isFailure: false,
        }))
        return false
      }
      return expireAttempt(deps, attemptId, paymentId, "NOT_FOUND")
    }
    logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "get_order_status" })
    const now = deps.clock()
    const exponent = Math.min(failureCount, 10)
    const base = error instanceof GatewayThrottledError ? pendingIntervalMs * 2 : pendingIntervalMs
    const backoffMs = Math.min(maxBackoffMs, base * 2 ** exponent)
    if (
      error instanceof GatewayMalformedResponseError && failureCount >= 2 && checkoutExpiresAt !== null &&
      now.getTime() > new Date(checkoutExpiresAt).getTime() + deps.config.notFoundGraceMs
    ) {
      await deps.unitOfWork.execute((tx) => deps.paymentsRepository.markReconciliationRequired(tx, {
        attemptId,
        paymentId,
        providerState: "MALFORMED_RESPONSE",
        now,
      }))
      return true
    }
    await deps.unitOfWork.execute((tx) => deps.paymentsRepository.rescheduleAttemptReconciliation(tx, {
      attemptId,
      now,
      nextCheckAt: new Date(now.getTime() + backoffMs),
      isFailure: true,
    }))
    return false
  }

  const now = deps.clock()
  if (providerState === "EXPIRED") return expireAttempt(deps, attemptId, paymentId, providerState)
  return deps.unitOfWork.execute(async (tx) => {
    if (fact.outcome !== "pending") {
      await applyCanonicalPaymentOutcome(tx, deps.paymentsRepository, {
        merchantOrderId,
        providerMerchantOrderId: fact.merchantOrderId,
        outcome: fact.outcome,
        providerState: fact.providerState,
        providerOrderId: fact.providerOrderId,
        amountPaise: fact.amountPaise,
        currency: fact.currency,
        details: fact.details,
      }, now, deps.settlementRepository)
      return true
    }
    if (
      checkoutExpiresAt !== null &&
      now.getTime() > new Date(checkoutExpiresAt).getTime() + deps.config.notFoundGraceMs
    ) {
      await deps.paymentsRepository.markReconciliationRequired(tx, {
        attemptId,
        paymentId,
        providerState,
        now,
      })
      return true
    }
    await deps.paymentsRepository.rescheduleAttemptReconciliation(tx, {
      attemptId,
      now,
      nextCheckAt: new Date(now.getTime() + pendingIntervalMs),
      isFailure: false,
    })
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
  existingProviderRefundId: string | null,
): Promise<boolean> => {
  if (state === "pending") {
    const attempt = await deps.unitOfWork.execute((tx) =>
      deps.paymentsRepository.latestAttempt(tx, paymentId),
    )
    if (attempt === null || attempt.state !== "succeeded") return false

    let providerRefundId: string | null = null
    try {
      const initiated = await deps.paymentGateway.initiateRefund({
        merchantRefundId,
        originalMerchantOrderId: attempt.merchant_order_id,
        amountPaise,
      })
      providerRefundId = initiated.providerRefundId
    } catch (error) {
      logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "initiate_refund" })
      return false
    }
    const now = deps.clock()
    if (
      existingProviderRefundId !== null &&
      providerRefundId !== null &&
      providerRefundId !== existingProviderRefundId
    ) {
      logGatewayFailure(deps.logger, new Error("provider refund identity mismatch"), {
        requestId: randomUUID(),
        operation: "initiate_refund",
      })
      return deps.unitOfWork.execute(async (tx) => {
        const failed = await deps.refundRepository.markFailed(tx, {
          refundId,
          failureCode: "PROVIDER_REFUND_ID_MISMATCH",
          now,
        })
        if (failed === null) throw new Error("refund identity quarantine failed")
        if (await deps.paymentsRepository.markPaymentRefundFailed(tx, paymentId, now) === null) {
          throw new Error("payment refund identity quarantine failed")
        }
        if (await deps.paymentsRepository.markOrderRefundFailed(tx, {
          orderId,
          failureCode: "PROVIDER_REFUND_ID_MISMATCH",
          now,
        }) === null) throw new Error("order refund identity quarantine failed")
        return true
      })
    }
    return deps.unitOfWork.execute(async (tx) => {
      const boundProviderRefundId = existingProviderRefundId ?? providerRefundId
      if (await deps.refundRepository.markProviderPending(tx, {
        refundId,
        providerRefundId: boundProviderRefundId,
        now,
      }) === null) throw new Error("refund dispatch transition failed")
      return false
    })
  }

  let fact
  try {
    fact = await deps.paymentGateway.getRefundStatus(merchantRefundId)
  } catch (error) {
    logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "get_refund_status" })
    return false
  }

  const now = deps.clock()
  return deps.unitOfWork.execute(async (tx) => {
    const lockedRefund = await deps.refundRepository.lockById(tx, refundId)
    const originalAttempt = await deps.paymentsRepository.latestAttempt(tx, paymentId)
    if (
      lockedRefund === null ||
      originalAttempt === null ||
      originalAttempt.state !== "succeeded" ||
      !isRefundEvidenceCorrelated({
        expectedAmountPaise: lockedRefund.amount_paise,
        expectedMerchantOrderId: originalAttempt.merchant_order_id,
        expectedProviderRefundId: lockedRefund.provider_refund_id,
        providerRefundId: fact.providerRefundId,
        amountPaise: fact.amountPaise,
        originalMerchantOrderId: fact.originalMerchantOrderId,
      })
    ) {
      if (lockedRefund !== null) await deps.refundRepository.markStatusChecked(tx, { refundId, now })
      return false
    }
    if (fact.outcome === "succeeded") {
      if (lockedRefund.state === "refunded") return true
      const refunded = await deps.refundRepository.markRefunded(tx, {
        refundId,
        providerRefundId: fact.providerRefundId,
        now,
      })
      if (refunded === null) throw new Error("refund success transition failed")
      if (await deps.paymentsRepository.markPaymentRefunded(tx, paymentId, now) === null) {
        throw new Error("payment refund transition failed")
      }
      if (await deps.paymentsRepository.markOrderRefunded(tx, orderId, now) === null) {
        throw new Error("order refund transition failed")
      }
      return true
    }
    if (fact.outcome === "failed") {
      if (lockedRefund.state === "failed") return true
      const failed = await deps.refundRepository.markFailed(tx, {
        refundId,
        failureCode: "PROVIDER_REFUND_FAILED",
        now,
      })
      if (failed === null) throw new Error("refund failure transition failed")
      if (await deps.paymentsRepository.markPaymentRefundFailed(tx, paymentId, now) === null) {
        throw new Error("payment refund failure transition failed")
      }
      if (await deps.paymentsRepository.markOrderRefundFailed(tx, {
        orderId,
        failureCode: "PROVIDER_REFUND_FAILED",
        now,
      }) === null) throw new Error("order refund failure transition failed")
      return true
    }
    await deps.refundRepository.markStatusChecked(tx, { refundId, now })
    return false
  })
}

export const runReconciliationPass = async (
  deps: PaymentReconciliationDeps,
): Promise<ReconciliationSummary> => {
  const claimedAttemptIds = new Set<string>()
  let attemptsChecked = 0
  let attemptsResolved = 0
  while (attemptsChecked < deps.config.claimLimit) {
    const now = deps.clock()
    const [attempt] = await deps.unitOfWork.execute((tx) =>
      deps.paymentsRepository.lockAttemptsForReconciliation(tx, {
        limit: 1,
        createdDueBefore: new Date(now.getTime() - deps.config.notFoundGraceMs),
        now,
        leaseExpiresAt: new Date(now.getTime() + (deps.config.leaseMs ?? 60_000)),
      }),
    )
    if (attempt === undefined || claimedAttemptIds.has(attempt.id)) break
    claimedAttemptIds.add(attempt.id)
    attemptsChecked += 1
    const resolved = await reconcileAttempt(
      deps,
      attempt.id,
      attempt.payment_id,
      attempt.merchant_order_id,
      attempt.checkout_expires_at,
      attempt.reconciliation_failure_count,
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
      refund.provider_refund_id,
    )
    if (resolved) refundsResolved += 1
  }

  return {
    attemptsChecked,
    attemptsResolved,
    refundsChecked: refunds.length,
    refundsResolved,
  }
}
