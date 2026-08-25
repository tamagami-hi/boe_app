import type { Transaction } from "../../db/repositories.js"
import type { PaymentsRepository } from "../../repositories/paymentsRepository.js"

export interface CanonicalPaymentDetail {
  readonly transactionId: string
  readonly reference: string | null
  readonly instrumentType: string | null
  readonly state: string | null
  readonly amountPaise: string | null
}

export interface CanonicalPaymentOutcome {
  readonly merchantOrderId: string
  readonly providerMerchantOrderId: string | null
  readonly outcome: "succeeded" | "failed" | "pending"
  readonly providerState: string
  readonly providerOrderId: string | null
  readonly amountPaise: string | null
  readonly currency: string | null
  readonly details: readonly CanonicalPaymentDetail[]
}

const isCompletedEvidenceValid = (
  attempt: Awaited<ReturnType<PaymentsRepository["lockAttemptById"]>>,
  payment: Awaited<ReturnType<PaymentsRepository["lockPaymentById"]>>,
  outcome: CanonicalPaymentOutcome,
): boolean => {
  if (attempt === null || payment === null) return false
  if (outcome.providerState !== "COMPLETED") return false
  if (outcome.providerMerchantOrderId !== outcome.merchantOrderId) return false
  if (payment.currency !== "INR" || outcome.currency !== "INR") return false
  if (outcome.amountPaise === null || outcome.amountPaise !== payment.amount_paise) return false
  if (attempt.provider_order_id !== null && attempt.provider_order_id !== outcome.providerOrderId) return false
  if (outcome.providerOrderId === null) return false
  const completedDetails = outcome.details.filter((detail) => detail.state === "COMPLETED")
  if (
    completedDetails.length === 0 ||
    completedDetails.some((detail) => detail.amountPaise === null || !/^[1-9][0-9]*$/u.test(detail.amountPaise))
  ) return false
  const total = completedDetails.reduce((sum, detail) => sum + BigInt(detail.amountPaise as string), 0n)
  return total === BigInt(outcome.amountPaise)
}

const recordDetails = async (
  tx: Transaction,
  paymentsRepository: PaymentsRepository,
  attempt: NonNullable<Awaited<ReturnType<PaymentsRepository["lockAttemptById"]>>>,
  details: readonly CanonicalPaymentDetail[],
): Promise<void> => {
  for (const detail of details) {
    await paymentsRepository.recordPaymentDetail(tx, {
      paymentAttemptId: attempt.id,
      userId: attempt.user_id,
      transactionId: detail.transactionId,
      reference: detail.reference,
      instrumentType: detail.instrumentType,
      state: detail.state,
      amountPaise: detail.amountPaise,
    })
  }
}

export const applyCanonicalPaymentOutcome = async (
  tx: Transaction,
  paymentsRepository: PaymentsRepository,
  outcome: CanonicalPaymentOutcome,
  now: Date,
): Promise<void> => {
  const candidate = await paymentsRepository.findAttemptByMerchantOrderId(tx, outcome.merchantOrderId)
  if (candidate === null) return
  const attempt = await paymentsRepository.lockAttemptById(tx, candidate.id)
  if (attempt === null) return
  const payment = await paymentsRepository.lockPaymentById(tx, attempt.payment_id)
  if (payment === null || payment.user_id !== attempt.user_id) throw new Error("payment correlation failed")
  const order = await paymentsRepository.lockOrderById(tx, payment.order_id)
  if (
    order === null ||
    order.user_id !== payment.user_id ||
    order.amount_paise !== payment.amount_paise ||
    order.currency !== payment.currency
  ) {
    throw new Error("order correlation failed")
  }
  if (attempt.state === "reconciliation_required" && payment.state === "reconciliation_required") return
  if (outcome.providerMerchantOrderId !== outcome.merchantOrderId) {
    await paymentsRepository.markReconciliationRequired(tx, {
      attemptId: attempt.id,
      paymentId: payment.id,
      providerState: outcome.providerState,
      now,
    })
    return
  }
  if (outcome.outcome === "succeeded") {
    if (attempt.state === "succeeded" && payment.state === "succeeded") {
      if (["review_pending", "accepted", "refund_pending", "refund_failed", "refunded"].includes(order.state)) return
      throw new Error("order success correlation failed")
    }
    if (!isCompletedEvidenceValid(attempt, payment, outcome)) {
      await paymentsRepository.markReconciliationRequired(tx, {
        attemptId: attempt.id,
        paymentId: payment.id,
        providerState: outcome.providerState,
        now,
      })
      return
    }
    await recordDetails(tx, paymentsRepository, attempt, outcome.details)
    if (await paymentsRepository.markAttemptSucceeded(tx, {
      attemptId: attempt.id,
      providerState: outcome.providerState,
      providerOrderId: outcome.providerOrderId,
      now,
    }) === null) throw new Error("attempt success transition failed")
    const succeededPayment = await paymentsRepository.markPaymentSucceeded(tx, attempt.payment_id, now)
    if (succeededPayment === null) throw new Error("payment success transition failed")
    if (await paymentsRepository.markOrderReviewPending(tx, succeededPayment.order_id, now) === null) {
      throw new Error("order review transition failed")
    }
    await paymentsRepository.createPendingReview(tx, succeededPayment.order_id)
    return
  }
  if (outcome.outcome !== "failed") return
  if (attempt.state === "failed" && payment.state === "failed") {
    if (order.state === "payment_failed") return
    throw new Error("order failure correlation failed")
  }
  await recordDetails(tx, paymentsRepository, attempt, outcome.details)
  if (await paymentsRepository.markAttemptFailed(tx, {
    attemptId: attempt.id,
    providerState: outcome.providerState,
    failureCode: "PROVIDER_DECLINED",
    now,
  }) === null) throw new Error("attempt failure transition failed")
  const failedPayment = await paymentsRepository.markPaymentFailed(tx, {
    paymentId: attempt.payment_id,
    failureCode: "PROVIDER_DECLINED",
    now,
  })
  if (failedPayment === null) throw new Error("payment failure transition failed")
  if (await paymentsRepository.markOrderPaymentFailed(tx, {
    orderId: failedPayment.order_id,
    failureCode: "PROVIDER_DECLINED",
    now,
  }) === null) throw new Error("order failure transition failed")
}
