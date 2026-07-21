/**
 * Payment write repository (spec 03 §4.4, §5.2, §6, §7). `beginPayment` creates
 * the payment aggregate and its first attempt in the same transaction as the
 * order transition and the provider-call outbox event; the actual provider
 * network call is a later worker (`sendPaymentToProvider`) that consumes that
 * attempt and outbox and never runs inside a transaction. Ownership is carried
 * by composite `(id, user_id)` / `(payment_id, user_id)` foreign keys.
 */
import type { Payment, PaymentAttempt, Transaction } from "../db/repositories.js"

export interface CreatePaymentInput {
  readonly orderId: string
  readonly userId: string
  readonly amountPaise: string
  readonly currency: string
  readonly provider: string
  /** Attempt expiry (provider authorization window), or null. */
  readonly attemptExpiresAt: Date | null
}

export interface CreatedPayment {
  readonly payment: Payment
  readonly attempt: PaymentAttempt
}

export interface PaymentWriteRepository {
  /** Create the payment (state `created`) and its first attempt (attempt_number 1). */
  createWithFirstAttempt: (tx: Transaction, input: CreatePaymentInput) => Promise<CreatedPayment>
}

export const createPaymentRepository = (): PaymentWriteRepository => ({
  createWithFirstAttempt: async (tx, input) => {
    const payment = await tx
      .insertInto("payments")
      .values({
        order_id: input.orderId,
        user_id: input.userId,
        amount_paise: input.amountPaise,
        currency: input.currency,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    const attempt = await tx
      .insertInto("payment_attempts")
      .values({
        payment_id: payment.id,
        user_id: input.userId,
        attempt_number: 1,
        provider: input.provider,
        ...(input.attemptExpiresAt === null ? {} : { expires_at: input.attemptExpiresAt }),
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return { payment, attempt }
  },
})
