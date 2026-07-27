/**
 * Payment write repository (spec 03 §4.4, §5.2, §6, §7). `beginPayment` creates
 * the payment aggregate and its first attempt in the same transaction as the
 * order transition and the provider-call outbox event; the actual provider
 * network call is a later worker (`sendPaymentToProvider`) that consumes that
 * attempt and outbox and never runs inside a transaction. Ownership is carried
 * by composite `(id, user_id)` / `(payment_id, user_id)` foreign keys.
 */
import { sql } from "kysely"

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
  /** Resolve a payment by its id (used by the settlement worker to find its order/owner). */
  findById: (tx: Transaction, paymentId: string) => Promise<Payment | null>
  /** Lock the order's payment aggregate for a state transition. */
  lockByOrder: (
    tx: Transaction,
    input: Readonly<{ orderId: string; userId: string }>,
  ) => Promise<Payment | null>
  /** created -> provider_pending on the payment and its current attempt. */
  sendToProvider: (
    tx: Transaction,
    input: Readonly<{ paymentId: string; userId: string; providerPaymentId: string; now: Date }>,
  ) => Promise<Payment | null>
  /** provider_pending -> succeeded on the payment and its current attempt. */
  succeed: (
    tx: Transaction,
    input: Readonly<{ paymentId: string; userId: string; now: Date }>,
  ) => Promise<Payment | null>
  /** created|provider_pending -> failed on the payment and its current attempt. */
  fail: (
    tx: Transaction,
    input: Readonly<{ paymentId: string; userId: string; failureCode: string; now: Date }>,
  ) => Promise<Payment | null>
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

  findById: async (tx, paymentId) => {
    const row = await tx.selectFrom("payments").selectAll().where("id", "=", paymentId).executeTakeFirst()
    return row ?? null
  },

  lockByOrder: async (tx, input) => {
    const row = await tx
      .selectFrom("payments")
      .selectAll()
      .where("order_id", "=", input.orderId)
      .where("user_id", "=", input.userId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  sendToProvider: async (tx, input) => {
    const row = await tx
      .updateTable("payments")
      .set({ state: "provider_pending", version: sql<string>`version + 1`, updated_at: sql<Date>`now()` })
      .where("id", "=", input.paymentId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "created")
      .returningAll()
      .executeTakeFirst()
    if (row === undefined) return null
    await tx
      .updateTable("payment_attempts")
      .set({
        state: "provider_pending",
        provider_payment_id: input.providerPaymentId,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("payment_id", "=", input.paymentId)
      .where("state", "=", "created")
      .execute()
    return row
  },

  succeed: async (tx, input) => {
    const row = await tx
      .updateTable("payments")
      .set({
        state: "succeeded",
        succeeded_at: input.now,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.paymentId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "provider_pending")
      .returningAll()
      .executeTakeFirst()
    if (row === undefined) return null
    await tx
      .updateTable("payment_attempts")
      .set({ state: "succeeded", version: sql<string>`version + 1`, updated_at: sql<Date>`now()` })
      .where("payment_id", "=", input.paymentId)
      .where("state", "=", "provider_pending")
      .execute()
    return row
  },

  fail: async (tx, input) => {
    const row = await tx
      .updateTable("payments")
      .set({
        state: "failed",
        failed_at: input.now,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.paymentId)
      .where("user_id", "=", input.userId)
      .where("state", "in", ["created", "provider_pending"])
      .returningAll()
      .executeTakeFirst()
    if (row === undefined) return null
    await tx
      .updateTable("payment_attempts")
      .set({
        state: "failed",
        failure_code: input.failureCode,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("payment_id", "=", input.paymentId)
      .where("state", "in", ["created", "provider_pending"])
      .execute()
    return row
  },
})
