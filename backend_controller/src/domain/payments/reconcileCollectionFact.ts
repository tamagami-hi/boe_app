import type { Transaction } from "../../db/repositories.js"
import type { CollectionStatus } from "../../providers/recurringPaymentGateway.js"
import type { MandatesRepository } from "../../repositories/mandatesRepository.js"
import type { PaymentsRepository } from "../../repositories/paymentsRepository.js"
import { applyCanonicalPaymentOutcome } from "./applyCanonicalPaymentOutcome.js"

export interface ReconcileCollectionDeps {
  readonly mandatesRepository: MandatesRepository
  readonly paymentsRepository: PaymentsRepository
}

export const reconcileCollectionFact = async (
  tx: Transaction,
  deps: ReconcileCollectionDeps,
  fact: CollectionStatus,
  now: Date,
): Promise<boolean> => {
  const collection = await deps.mandatesRepository.findCollectionAttemptByMerchantOrder(tx, fact.merchantOrderId)
  if (collection === null || collection.amount_paise !== fact.amountPaise) {
    throw new Error("collection correlation mismatch")
  }
  const mandate = await deps.mandatesRepository.findMandateForAdmin(tx, collection.mandate_id)
  if (mandate === null || mandate.merchant_subscription_id !== fact.merchantSubscriptionId) {
    throw new Error("collection correlation mismatch")
  }
  if (collection.notify_state === "created") {
    await deps.paymentsRepository.markAttemptStatusChecked(tx, { attemptId: collection.payment_attempt_id, now })
    return false
  }
  if (collection.notify_state === "dispatching" && fact.state !== "NOTIFICATION_IN_PROGRESS") {
    await deps.mandatesRepository.applyProviderNotificationOutcome(tx, {
      paymentAttemptId: collection.payment_attempt_id,
      expectedVersion: collection.version,
      toState: "notified",
      now,
    })
  }
  if (fact.state === "NOTIFICATION_IN_PROGRESS" || fact.state === "NOTIFIED" || fact.state === "PENDING") {
    await deps.paymentsRepository.markAttemptStatusChecked(tx, { attemptId: collection.payment_attempt_id, now })
    return false
  }
  const matchingCompleted = fact.paymentDetails.filter((detail) =>
    detail.state === "COMPLETED" && detail.amountPaise === collection.amount_paise)
  if (fact.state === "COMPLETED" && matchingCompleted.length === 0) return false
  if (fact.state === "FAILED" && now < fact.expiresAt) {
    await deps.paymentsRepository.markAttemptStatusChecked(tx, { attemptId: collection.payment_attempt_id, now })
    return false
  }
  await applyCanonicalPaymentOutcome(tx, deps.paymentsRepository, {
    merchantOrderId: fact.merchantOrderId,
    outcome: fact.state === "COMPLETED" ? "succeeded" : "failed",
    providerState: fact.state,
    providerOrderId: fact.providerOrderId,
    details: fact.paymentDetails.map((detail) => ({
      transactionId: detail.transactionId,
      reference: null,
      instrumentType: detail.instrumentType,
      state: detail.state,
      amountPaise: detail.amountPaise,
    })),
  }, now)
  return true
}
