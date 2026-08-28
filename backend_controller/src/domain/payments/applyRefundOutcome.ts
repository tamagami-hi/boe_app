import type { Transaction } from "../../db/repositories.js"
import type { VerifiedCallback } from "../../providers/phonepe/paymentGateway.js"
import type { PaymentsRepository } from "../../repositories/paymentsRepository.js"
import type { RefundRepository } from "../../repositories/refundRepository.js"
import { isRefundEvidenceCorrelated } from "./refundEvidence.js"

export interface ApplyRefundOutcomeDeps {
  readonly paymentsRepository: PaymentsRepository
  readonly refundRepository: RefundRepository
}

export const applyRefundOutcome = async (
  deps: ApplyRefundOutcomeDeps,
  tx: Transaction,
  callback: VerifiedCallback,
  now: Date,
): Promise<void> => {
  if (callback.merchantRefundId === null) return
  const refund = await deps.refundRepository.lockByMerchantRefundId(tx, callback.merchantRefundId)
  if (refund === null) throw new Error("refund operation not found")
  const originalAttempt = await deps.paymentsRepository.latestAttempt(tx, refund.payment_id)
  if (
    originalAttempt === null ||
    originalAttempt.state !== "succeeded" ||
    !isRefundEvidenceCorrelated({
      expectedAmountPaise: refund.amount_paise,
      expectedMerchantOrderId: originalAttempt.merchant_order_id,
      expectedProviderRefundId: refund.provider_refund_id,
      providerRefundId: callback.providerRefundId,
      amountPaise: callback.amountPaise,
      originalMerchantOrderId: callback.originalMerchantOrderId,
    })
  ) throw new Error("refund correlation failed")

  if (callback.outcome === "succeeded") {
    if (refund.state === "refunded") return
    const refunded = await deps.refundRepository.markRefunded(tx, {
      refundId: refund.id,
      providerRefundId: callback.providerRefundId,
      now,
    })
    if (refunded === null) throw new Error("refund success transition failed")
    const payment = await deps.paymentsRepository.markPaymentRefunded(tx, refund.payment_id, now)
    if (payment === null) throw new Error("payment refund transition failed")
    if (await deps.paymentsRepository.markOrderRefunded(tx, refund.order_id, now) === null) {
      throw new Error("order refund transition failed")
    }
    return
  }

  if (callback.outcome === "failed") {
    if (refund.state === "failed") return
    const failed = await deps.refundRepository.markFailed(tx, {
      refundId: refund.id,
      failureCode: "PROVIDER_REFUND_FAILED",
      now,
    })
    if (failed === null) throw new Error("refund failure transition failed")
    const payment = await deps.paymentsRepository.markPaymentRefundFailed(tx, refund.payment_id, now)
    if (payment === null) throw new Error("payment refund failure transition failed")
    if (await deps.paymentsRepository.markOrderRefundFailed(tx, {
      orderId: refund.order_id,
      failureCode: "PROVIDER_REFUND_FAILED",
      now,
    }) === null) throw new Error("order refund failure transition failed")
  }
}
