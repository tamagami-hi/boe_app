import type { Transaction } from "../db/repositories.js"

export interface StaleCheckoutCandidate {
  readonly attemptId: string
  readonly paymentId: string
}

export interface StaleCheckoutRepository {
  listUndispatchedExpiredCandidates: (
    tx: Transaction,
    input: Readonly<{ expiredBefore: Date; limit: number }>,
  ) => Promise<readonly StaleCheckoutCandidate[]>
  hasLiveOrSettledSibling: (
    tx: Transaction,
    input: Readonly<{ paymentId: string; attemptId: string }>,
  ) => Promise<boolean>
}

const SIBLING_BLOCKING_STATES = ["created", "provider_pending", "succeeded", "reconciliation_required"] as const

export const createStaleCheckoutRepository = (): StaleCheckoutRepository => ({
  listUndispatchedExpiredCandidates: async (tx, input) =>
    tx
      .selectFrom("payment_attempts as attempt")
      .innerJoin("payments as payment", "payment.id", "attempt.payment_id")
      .select(["attempt.id as attemptId", "attempt.payment_id as paymentId"])
      .where("attempt.checkout_channel", "=", "hosted_redirect")
      .where("attempt.state", "=", "created")
      .where("attempt.provider_dispatch_started_at", "is", null)
      .where("attempt.checkout_expires_at", "is not", null)
      .where("attempt.checkout_expires_at", "<=", input.expiredBefore)
      .where("payment.state", "=", "created")
      .where("payment.succeeded_at", "is", null)
      .orderBy("attempt.created_at")
      .orderBy("attempt.id")
      .limit(input.limit)
      .execute(),

  hasLiveOrSettledSibling: async (tx, input) => {
    const row = await tx
      .selectFrom("payment_attempts")
      .select("id")
      .where("payment_id", "=", input.paymentId)
      .where("id", "<>", input.attemptId)
      .where("state", "in", SIBLING_BLOCKING_STATES)
      .limit(1)
      .executeTakeFirst()
    return row !== undefined
  },
})
