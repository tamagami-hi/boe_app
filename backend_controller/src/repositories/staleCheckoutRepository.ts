import type { PaymentAttempt, Transaction } from "../db/repositories.js"

export interface StaleCheckoutRepository {
  lockNextUndispatchedExpiredAttempt: (
    tx: Transaction,
    input: Readonly<{ expiredBefore: Date; excludedAttemptIds: readonly string[] }>,
  ) => Promise<PaymentAttempt | null>
}

const SIBLING_BLOCKING_STATES = ["created", "provider_pending", "succeeded", "reconciliation_required"] as const

export const createStaleCheckoutRepository = (): StaleCheckoutRepository => ({
  lockNextUndispatchedExpiredAttempt: async (tx, input) => {
    const candidates = tx
      .selectFrom("payment_attempts as attempt")
      .innerJoin("payments as payment", "payment.id", "attempt.payment_id")
      .selectAll("attempt")
      .where("attempt.checkout_channel", "=", "hosted_redirect")
      .where("attempt.state", "=", "created")
      .where("attempt.provider_dispatch_started_at", "is", null)
      .where("attempt.checkout_expires_at", "is not", null)
      .where("attempt.checkout_expires_at", "<=", input.expiredBefore)
      .where("payment.state", "=", "created")
      .where("payment.succeeded_at", "is", null)
      .where((expression) => expression.not(expression.exists(
        expression.selectFrom("payment_attempts as sibling")
          .select("sibling.id")
          .whereRef("sibling.payment_id", "=", "attempt.payment_id")
          .whereRef("sibling.id", "<>", "attempt.id")
          .where("sibling.state", "in", SIBLING_BLOCKING_STATES),
      )))
    const filtered = input.excludedAttemptIds.length === 0
      ? candidates
      : candidates.where("attempt.id", "not in", input.excludedAttemptIds)
    const row = await filtered
      .orderBy("attempt.created_at")
      .orderBy("attempt.id")
      .limit(1)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst()
    return row ?? null
  },
})
