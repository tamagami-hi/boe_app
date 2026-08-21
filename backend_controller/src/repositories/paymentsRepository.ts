/**
 * Payments write/read repository (spec §5.1/§5.2/§5.5). Owns the payment
 * lifecycle tables — `payments`, `payment_attempts`, `provider_payment_details`
 * — and the order-side transitions that payment evidence drives
 * (`payment_pending`, `review_pending`, `payment_failed`, `refunded`, ...).
 *
 * Every transition is a guarded UPDATE: the WHERE clause names the states the
 * transition is legal from, so a replayed or out-of-order provider outcome
 * against an already-moved row is a no-op rather than a second effect. Money
 * columns are bigint and travel as decimal strings; nothing here coerces them
 * to numbers.
 *
 * Boundary rule (spec §4.1): this module never touches client value entries,
 * growth batches, or AUM snapshots; the admin accept command owns those writes.
 */
import { sql } from "kysely"

import type {
  InvestmentOrder,
  Payment,
  PaymentAttempt,
  Transaction,
} from "../db/repositories.js"
import type { FundState } from "../db/types.js"

export interface CreatePaymentInput {
  readonly orderId: string
  readonly userId: string
  readonly amountPaise: string
  readonly currency: string
}

export interface CreateAttemptInput {
  readonly paymentId: string
  readonly userId: string
  readonly attemptNumber: number
  readonly merchantOrderId: string
  readonly checkoutExpiresAt: Date
}

export interface RecordPaymentDetailInput {
  readonly paymentAttemptId: string
  readonly userId: string
  readonly transactionId: string
  readonly reference: string | null
  readonly instrumentType: string | null
  readonly state: string | null
  readonly amountPaise: string | null
}

/** Attempt states from which provider evidence may still move the attempt. */
const ATTEMPT_OPEN_STATES = ["created", "provider_pending"] as const
/** Payment states from which a success/failure outcome may be applied. */
const PAYMENT_OPEN_STATES = ["created", "provider_pending"] as const

/** One admin payment-ledger row: payment + order + client + latest attempt. */
export interface PaymentListRow {
  readonly id: string
  readonly orderId: string
  readonly userId: string
  readonly userEmail: string
  readonly amountPaise: string
  readonly status: Payment["state"]
  readonly provider: string | null
  readonly providerReference: string | null
  readonly attemptCount: number
  readonly succeededAt: Date | null
  readonly failedAt: Date | null
  readonly createdAt: Date
}

export interface PaymentsRepository {
  findFundState: (tx: Transaction, fundId: string) => Promise<FundState | null>
  lockOrderForPayment: (
    tx: Transaction,
    input: Readonly<{ orderId: string; userId: string }>,
  ) => Promise<InvestmentOrder | null>
  lockOrderById: (tx: Transaction, orderId: string) => Promise<InvestmentOrder | null>
  lockPaymentById: (tx: Transaction, paymentId: string) => Promise<Payment | null>
  lockPaymentByOrder: (tx: Transaction, orderId: string) => Promise<Payment | null>
  createPayment: (tx: Transaction, input: CreatePaymentInput) => Promise<Payment>
  latestAttempt: (tx: Transaction, paymentId: string) => Promise<PaymentAttempt | null>
  lockAttemptById: (tx: Transaction, attemptId: string) => Promise<PaymentAttempt | null>
  findAttemptByMerchantOrderId: (
    tx: Transaction,
    merchantOrderId: string,
  ) => Promise<PaymentAttempt | null>
  createAttempt: (tx: Transaction, input: CreateAttemptInput) => Promise<PaymentAttempt>
  /** created -> provider_pending after the provider handed back a checkout. */
  markAttemptDispatched: (
    tx: Transaction,
    input: Readonly<{
      attemptId: string
      providerOrderId: string | null
      checkoutExpiresAt: Date
      now: Date
    }>,
  ) => Promise<PaymentAttempt | null>
  markAttemptSucceeded: (
    tx: Transaction,
    input: Readonly<{
      attemptId: string
      providerState: string
      providerOrderId: string | null
      now: Date
    }>,
  ) => Promise<PaymentAttempt | null>
  markAttemptFailed: (
    tx: Transaction,
    input: Readonly<{
      attemptId: string
      providerState: string
      failureCode: string
      now: Date
    }>,
  ) => Promise<PaymentAttempt | null>
  markAttemptExpired: (
    tx: Transaction,
    input: Readonly<{ attemptId: string; providerState: string | null; now: Date }>,
  ) => Promise<PaymentAttempt | null>
  markAttemptStatusChecked: (
    tx: Transaction,
    input: Readonly<{ attemptId: string; now: Date }>,
  ) => Promise<void>
  /** created|provider_pending -> provider_pending (payment is at the provider). */
  markPaymentProviderPending: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  markPaymentSucceeded: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  markPaymentFailed: (
    tx: Transaction,
    input: Readonly<{ paymentId: string; failureCode: string; now: Date }>,
  ) => Promise<Payment | null>
  markPaymentExpired: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  /** succeeded -> refund_pending (reject path). */
  markPaymentRefundPending: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  /** refund_pending -> refunded on verified refund evidence. */
  markPaymentRefunded: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  /** refund_pending -> refund_failed on exhausted terminal refund failure. */
  markPaymentRefundFailed: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  /** submitted|payment_pending|payment_failed -> payment_pending (checkout begins). */
  markOrderPaymentPending: (tx: Transaction, orderId: string, now: Date) => Promise<InvestmentOrder | null>
  /** payment_pending -> review_pending on verified provider success. */
  markOrderReviewPending: (tx: Transaction, orderId: string, now: Date) => Promise<InvestmentOrder | null>
  markOrderPaymentFailed: (
    tx: Transaction,
    input: Readonly<{ orderId: string; failureCode: string; now: Date }>,
  ) => Promise<InvestmentOrder | null>
  /** refund_pending -> refunded | refund_failed. */
  markOrderRefunded: (tx: Transaction, orderId: string, now: Date) => Promise<InvestmentOrder | null>
  markOrderRefundFailed: (
    tx: Transaction,
    input: Readonly<{ orderId: string; failureCode: string; now: Date }>,
  ) => Promise<InvestmentOrder | null>
  /**
   * Insert the pending admin review for a succeeded payment (spec §5.5).
   * Idempotent: one review per order, `ON CONFLICT DO NOTHING`.
   */
  createPendingReview: (tx: Transaction, orderId: string) => Promise<void>
  /**
   * Normalize one provider `paymentDetails[]` entry (spec §5.2). Append-only:
   * keyed by (attempt, provider transaction); conflicts keep the first row.
   */
  recordPaymentDetail: (tx: Transaction, input: RecordPaymentDetailInput) => Promise<void>
  /** Worker claim: open attempts, oldest first, locked SKIP LOCKED. */
  lockAttemptsForReconciliation: (
    tx: Transaction,
    input: Readonly<{ limit: number }>,
  ) => Promise<readonly PaymentAttempt[]>
  /** Admin oversight read: the gateway evidence trail, most recent first. */
  listPage: (
    tx: Transaction,
    input: Readonly<{ afterCreatedAt?: Date; afterId?: string; limit: number }>,
  ) => Promise<readonly PaymentListRow[]>
}

export const createPaymentsRepository = (): PaymentsRepository => ({
  findFundState: async (tx, fundId) => {
    const row = await tx
      .selectFrom("funds")
      .select("state")
      .where("id", "=", fundId)
      .executeTakeFirst()
    return row?.state ?? null
  },

  lockOrderForPayment: async (tx, input) => {
    const row = await tx
      .selectFrom("investment_orders")
      .selectAll()
      .where("id", "=", input.orderId)
      .where("user_id", "=", input.userId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  lockOrderById: async (tx, orderId) => {
    const row = await tx
      .selectFrom("investment_orders")
      .selectAll()
      .where("id", "=", orderId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  lockPaymentById: async (tx, paymentId) => {
    const row = await tx
      .selectFrom("payments")
      .selectAll()
      .where("id", "=", paymentId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  lockPaymentByOrder: async (tx, orderId) => {
    const row = await tx
      .selectFrom("payments")
      .selectAll()
      .where("order_id", "=", orderId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  createPayment: async (tx, input) =>
    tx
      .insertInto("payments")
      .values({
        order_id: input.orderId,
        user_id: input.userId,
        amount_paise: input.amountPaise,
        currency: input.currency,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  latestAttempt: async (tx, paymentId) => {
    const row = await tx
      .selectFrom("payment_attempts")
      .selectAll()
      .where("payment_id", "=", paymentId)
      .orderBy("attempt_number", "desc")
      .limit(1)
      .executeTakeFirst()
    return row ?? null
  },

  lockAttemptById: async (tx, attemptId) => {
    const row = await tx
      .selectFrom("payment_attempts")
      .selectAll()
      .where("id", "=", attemptId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  findAttemptByMerchantOrderId: async (tx, merchantOrderId) => {
    const row = await tx
      .selectFrom("payment_attempts")
      .selectAll()
      .where("merchant_order_id", "=", merchantOrderId)
      .executeTakeFirst()
    return row ?? null
  },

  createAttempt: async (tx, input) =>
    tx
      .insertInto("payment_attempts")
      .values({
        payment_id: input.paymentId,
        user_id: input.userId,
        attempt_number: input.attemptNumber,
        provider: "phonepe",
        merchant_order_id: input.merchantOrderId,
        checkout_expires_at: input.checkoutExpiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  markAttemptDispatched: async (tx, input) => {
    const row = await tx
      .updateTable("payment_attempts")
      .set({
        state: "provider_pending",
        provider_order_id: input.providerOrderId,
        provider_state: "PENDING",
        checkout_expires_at: input.checkoutExpiresAt,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.attemptId)
      .where("state", "in", ATTEMPT_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markAttemptSucceeded: async (tx, input) => {
    const row = await tx
      .updateTable("payment_attempts")
      .set({
        state: "succeeded",
        provider_state: input.providerState,
        provider_order_id: input.providerOrderId,
        last_status_checked_at: input.now,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.attemptId)
      .where("state", "in", ATTEMPT_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markAttemptFailed: async (tx, input) => {
    const row = await tx
      .updateTable("payment_attempts")
      .set({
        state: "failed",
        provider_state: input.providerState,
        failure_code: input.failureCode,
        last_status_checked_at: input.now,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.attemptId)
      .where("state", "in", ATTEMPT_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markAttemptExpired: async (tx, input) => {
    const row = await tx
      .updateTable("payment_attempts")
      .set({
        state: "expired",
        provider_state: input.providerState,
        last_status_checked_at: input.now,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.attemptId)
      .where("state", "in", ATTEMPT_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markAttemptStatusChecked: async (tx, input) => {
    await tx
      .updateTable("payment_attempts")
      .set({ last_status_checked_at: input.now, updated_at: input.now })
      .where("id", "=", input.attemptId)
      .execute()
  },

  markPaymentProviderPending: async (tx, paymentId, now) => {
    const row = await tx
      .updateTable("payments")
      .set({ state: "provider_pending", updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", paymentId)
      .where("state", "in", PAYMENT_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markPaymentSucceeded: async (tx, paymentId, now) => {
    const row = await tx
      .updateTable("payments")
      .set({ state: "succeeded", succeeded_at: now, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", paymentId)
      .where("state", "in", PAYMENT_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markPaymentFailed: async (tx, input) => {
    const row = await tx
      .updateTable("payments")
      .set({
        state: "failed",
        failed_at: input.now,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.paymentId)
      .where("state", "in", PAYMENT_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markPaymentExpired: async (tx, paymentId, now) => {
    const row = await tx
      .updateTable("payments")
      .set({ state: "expired", updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", paymentId)
      .where("state", "in", PAYMENT_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markPaymentRefundPending: async (tx, paymentId, now) => {
    const row = await tx
      .updateTable("payments")
      .set({ state: "refund_pending", updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", paymentId)
      .where("state", "=", "succeeded")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markPaymentRefunded: async (tx, paymentId, now) => {
    const row = await tx
      .updateTable("payments")
      .set({ state: "refunded", refunded_at: now, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", paymentId)
      .where("state", "=", "refund_pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markPaymentRefundFailed: async (tx, paymentId, now) => {
    const row = await tx
      .updateTable("payments")
      .set({ state: "refund_failed", updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", paymentId)
      .where("state", "=", "refund_pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markOrderPaymentPending: async (tx, orderId, now) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({ state: "payment_pending", updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", orderId)
      .where("state", "in", ["submitted", "payment_pending", "payment_failed"])
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markOrderReviewPending: async (tx, orderId, now) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({
        state: "review_pending",
        payment_confirmed_at: now,
        updated_at: now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", orderId)
      .where("state", "=", "payment_pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markOrderPaymentFailed: async (tx, input) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({
        state: "payment_failed",
        failure_code: input.failureCode,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.orderId)
      .where("state", "in", ["submitted", "payment_pending"])
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markOrderRefunded: async (tx, orderId, now) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({ state: "refunded", updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", orderId)
      .where("state", "=", "refund_pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markOrderRefundFailed: async (tx, input) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({
        state: "refund_failed",
        failure_code: input.failureCode,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.orderId)
      .where("state", "=", "refund_pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  createPendingReview: async (tx, orderId) => {
    await tx
      .insertInto("investment_reviews")
      .values({ order_id: orderId })
      .onConflict((builder) => builder.column("order_id").doNothing())
      .execute()
  },

  recordPaymentDetail: async (tx, input) => {
    await tx
      .insertInto("provider_payment_details")
      .values({
        payment_attempt_id: input.paymentAttemptId,
        user_id: input.userId,
        provider_transaction_id: input.transactionId,
        provider_reference: input.reference,
        instrument_type: input.instrumentType,
        state: input.state,
        amount_paise: input.amountPaise,
      })
      .onConflict((builder) =>
        builder.columns(["payment_attempt_id", "provider_transaction_id"]).doNothing(),
      )
      .execute()
  },

  lockAttemptsForReconciliation: async (tx, input) =>
    tx
      .selectFrom("payment_attempts")
      .selectAll()
      .where("state", "in", ATTEMPT_OPEN_STATES)
      .orderBy("created_at")
      .orderBy("id")
      .limit(input.limit)
      .forUpdate()
      .skipLocked()
      .execute(),

  listPage: async (tx, input) => {
    const result = await sql<PaymentListRow>`
      select
        p.id,
        p.order_id as "orderId",
        p.user_id as "userId",
        u.email_normalized as "userEmail",
        p.amount_paise::text as "amountPaise",
        p.state as "status",
        a.provider as "provider",
        a.provider_order_id as "providerReference",
        coalesce(ac.attempt_count, 0)::int as "attemptCount",
        p.succeeded_at as "succeededAt",
        p.failed_at as "failedAt",
        p.created_at as "createdAt"
      from payments p
      join users u on u.id = p.user_id
      left join lateral (
        select provider, provider_order_id
        from payment_attempts pa
        where pa.payment_id = p.id
        order by pa.attempt_number desc
        limit 1
      ) a on true
      left join lateral (
        select count(*) as attempt_count
        from payment_attempts pa
        where pa.payment_id = p.id
      ) ac on true
      where (${input.afterCreatedAt ?? null}::timestamptz is null
             or (p.created_at, p.id) < (${input.afterCreatedAt ?? null}, ${input.afterId ?? null}))
      order by p.created_at desc, p.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },
})
