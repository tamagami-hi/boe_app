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
  readonly outcome: "succeeded" | "failed" | "pending"
  readonly providerState: string
  readonly providerOrderId: string | null
  readonly details: readonly CanonicalPaymentDetail[]
}

export const applyCanonicalPaymentOutcome = async (
  tx: Transaction,
  paymentsRepository: PaymentsRepository,
  outcome: CanonicalPaymentOutcome,
  now: Date,
): Promise<void> => {
  const attempt = await paymentsRepository.findAttemptByMerchantOrderId(tx, outcome.merchantOrderId)
  if (attempt === null) return
  for (const detail of outcome.details) {
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
  if (outcome.outcome === "succeeded") {
    if (await paymentsRepository.markAttemptSucceeded(tx, {
      attemptId: attempt.id,
      providerState: outcome.providerState,
      providerOrderId: outcome.providerOrderId,
      now,
    }) === null) return
    const payment = await paymentsRepository.markPaymentSucceeded(tx, attempt.payment_id, now)
    if (payment === null) return
    await paymentsRepository.markOrderReviewPending(tx, payment.order_id, now)
    await paymentsRepository.createPendingReview(tx, payment.order_id)
    return
  }
  if (outcome.outcome !== "failed") return
  if (await paymentsRepository.markAttemptFailed(tx, {
    attemptId: attempt.id,
    providerState: outcome.providerState,
    failureCode: "PROVIDER_DECLINED",
    now,
  }) === null) return
  const payment = await paymentsRepository.markPaymentFailed(tx, {
    paymentId: attempt.payment_id,
    failureCode: "PROVIDER_DECLINED",
    now,
  })
  if (payment === null) return
  await paymentsRepository.markOrderPaymentFailed(tx, {
    orderId: payment.order_id,
    failureCode: "PROVIDER_DECLINED",
    now,
  })
}
