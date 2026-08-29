import { sql } from "kysely"

import type {
  InvestmentOrder,
  Payment,
  PaymentAttempt,
  Transaction,
} from "../db/repositories.js"

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
  readonly checkoutChannel: "hosted_redirect" | "phonepe_mandate_setup" | "phonepe_autopay"
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

const ATTEMPT_OPEN_STATES = ["created", "provider_pending"] as const
const PAYMENT_OPEN_STATES = ["created", "provider_pending"] as const

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
  findAttemptById: (tx: Transaction, attemptId: string) => Promise<PaymentAttempt | null>
  findAttemptByMerchantOrderId: (
    tx: Transaction,
    merchantOrderId: string,
  ) => Promise<PaymentAttempt | null>
  createAttempt: (tx: Transaction, input: CreateAttemptInput) => Promise<PaymentAttempt>
  markAttemptDispatchStarted: (tx: Transaction, attemptId: string, now: Date) => Promise<PaymentAttempt | null>
  markMandateAttemptDispatchStarted: (tx: Transaction, attemptId: string, now: Date) => Promise<PaymentAttempt | null>
  markMandateAttemptDispatched: (
    tx: Transaction,
    input: Readonly<{ attemptId: string; providerOrderId: string; checkoutExpiresAt: Date; now: Date }>,
  ) => Promise<PaymentAttempt | null>
  markAutoPayAttemptDispatchStarted: (tx: Transaction, attemptId: string, now: Date) => Promise<PaymentAttempt | null>
  markAutoPayAttemptDispatched: (
    tx: Transaction,
    input: Readonly<{ attemptId: string; providerOrderId: string; checkoutExpiresAt: Date; now: Date }>,
  ) => Promise<PaymentAttempt | null>
  markAttemptDispatched: (
    tx: Transaction,
    input: Readonly<{
      attemptId: string
      providerOrderId: string
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
  rescheduleAttemptReconciliation: (
    tx: Transaction,
    input: Readonly<{ attemptId: string; now: Date; nextCheckAt: Date; isFailure: boolean }>,
  ) => Promise<void>
  markReconciliationRequired: (
    tx: Transaction,
    input: Readonly<{ attemptId: string; paymentId: string; providerState: string; now: Date }>,
  ) => Promise<void>
  markPaymentProviderPending: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  markPaymentSucceeded: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  markPaymentFailed: (
    tx: Transaction,
    input: Readonly<{ paymentId: string; failureCode: string; now: Date }>,
  ) => Promise<Payment | null>
  markPaymentExpired: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  markPaymentRetryCreated: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  markPaymentRefundPending: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  requeuePaymentRefund: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  markPaymentRefunded: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  markPaymentRefundFailed: (tx: Transaction, paymentId: string, now: Date) => Promise<Payment | null>
  markOrderPaymentPending: (tx: Transaction, orderId: string, now: Date) => Promise<InvestmentOrder | null>
  markOrderAcceptedOnSettlement: (tx: Transaction, orderId: string, now: Date) => Promise<InvestmentOrder | null>
  markOrderPaymentFailed: (
    tx: Transaction,
    input: Readonly<{ orderId: string; failureCode: string; now: Date }>,
  ) => Promise<InvestmentOrder | null>
  requeueOrderRefund: (tx: Transaction, orderId: string, now: Date) => Promise<InvestmentOrder | null>
  markOrderRefunded: (tx: Transaction, orderId: string, now: Date) => Promise<InvestmentOrder | null>
  markOrderRefundFailed: (
    tx: Transaction,
    input: Readonly<{ orderId: string; failureCode: string; now: Date }>,
  ) => Promise<InvestmentOrder | null>
  recordPaymentDetail: (tx: Transaction, input: RecordPaymentDetailInput) => Promise<void>
  lockAttemptsForReconciliation: (
    tx: Transaction,
    input: Readonly<{ limit: number; createdDueBefore: Date; now: Date; leaseExpiresAt: Date }>,
  ) => Promise<readonly PaymentAttempt[]>
  earliestReconciliationDueAt: (
    tx: Transaction,
    input: Readonly<{ createdDueBefore: Date; now: Date }>,
  ) => Promise<Date | null>
  listPage: (
    tx: Transaction,
    input: Readonly<{ afterCreatedAt?: Date; afterId?: string; limit: number }>,
  ) => Promise<readonly PaymentListRow[]>
}

export const createPaymentsRepository = (): PaymentsRepository => ({
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

  findAttemptById: async (tx, attemptId) => {
    const row = await tx
      .selectFrom("payment_attempts")
      .selectAll()
      .where("id", "=", attemptId)
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
        checkout_channel: input.checkoutChannel,
        merchant_order_id: input.merchantOrderId,
        checkout_expires_at: input.checkoutExpiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  markAttemptDispatchStarted: async (tx, attemptId, now) => {
    const row = await tx
      .updateTable("payment_attempts")
      .set({ provider_dispatch_started_at: now, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", attemptId)
      .where("checkout_channel", "=", "hosted_redirect")
      .where("state", "=", "created")
      .where("provider_dispatch_started_at", "is", null)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markMandateAttemptDispatchStarted: async (tx, attemptId, now) => {
    const row = await tx.updateTable("payment_attempts")
      .set({ provider_dispatch_started_at: now, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", attemptId).where("checkout_channel", "=", "phonepe_mandate_setup")
      .where("state", "=", "created").where("provider_dispatch_started_at", "is", null)
      .returningAll().executeTakeFirst()
    return row ?? null
  },

  markMandateAttemptDispatched: async (tx, input) => {
    const row = await tx.updateTable("payment_attempts").set({
      state: "provider_pending",
      provider_order_id: input.providerOrderId,
      provider_state: "PENDING",
      checkout_expires_at: input.checkoutExpiresAt,
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("id", "=", input.attemptId).where("checkout_channel", "=", "phonepe_mandate_setup")
      .where("state", "=", "created").where("provider_dispatch_started_at", "is not", null)
      .returningAll().executeTakeFirst()
    return row ?? null
  },

  markAutoPayAttemptDispatchStarted: async (tx, attemptId, now) => (await tx.updateTable("payment_attempts").set({
    provider_dispatch_started_at: now,
    updated_at: now,
    version: sql<string>`version + 1`,
  }).where("id", "=", attemptId).where("checkout_channel", "=", "phonepe_autopay")
    .where("state", "=", "created").where("provider_dispatch_started_at", "is", null)
    .returningAll().executeTakeFirst()) ?? null,

  markAutoPayAttemptDispatched: async (tx, input) => (await tx.updateTable("payment_attempts").set({
    state: "provider_pending",
    provider_order_id: input.providerOrderId,
    provider_state: "NOTIFICATION_IN_PROGRESS",
    checkout_expires_at: input.checkoutExpiresAt,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("id", "=", input.attemptId).where("checkout_channel", "=", "phonepe_autopay")
    .where("state", "=", "created").where("provider_dispatch_started_at", "is not", null)
    .returningAll().executeTakeFirst()) ?? null,

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
      .where("checkout_channel", "=", "hosted_redirect")
      .where("state", "=", "created")
      .where("provider_dispatch_started_at", "is not", null)
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
        next_status_check_at: null,
        reconciliation_lease_expires_at: null,
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
        next_status_check_at: null,
        reconciliation_lease_expires_at: null,
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
        next_status_check_at: null,
        reconciliation_lease_expires_at: null,
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

  rescheduleAttemptReconciliation: async (tx, input) => {
    await tx
      .updateTable("payment_attempts")
      .set({
        last_status_checked_at: input.now,
        next_status_check_at: input.nextCheckAt,
        reconciliation_lease_expires_at: null,
        reconciliation_failure_count: input.isFailure
          ? sql<number>`reconciliation_failure_count + 1`
          : 0,
        updated_at: input.now,
      })
      .where("id", "=", input.attemptId)
      .where("state", "in", ATTEMPT_OPEN_STATES)
      .execute()
  },

  markReconciliationRequired: async (tx, input) => {
    const attempt = await tx
      .updateTable("payment_attempts")
      .set({
        state: "reconciliation_required",
        provider_state: input.providerState,
        last_status_checked_at: input.now,
        next_status_check_at: null,
        reconciliation_lease_expires_at: null,
        reconciliation_required_at: input.now,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.attemptId)
      .where("state", "in", ATTEMPT_OPEN_STATES)
      .returning("id")
      .executeTakeFirst()
    if (attempt === undefined) throw new Error("attempt reconciliation transition failed")
    const payment = await tx
      .updateTable("payments")
      .set({ state: "reconciliation_required", updated_at: input.now, version: sql<string>`version + 1` })
      .where("id", "=", input.paymentId)
      .where("state", "in", PAYMENT_OPEN_STATES)
      .returning("id")
      .executeTakeFirst()
    if (payment === undefined) throw new Error("payment reconciliation transition failed")
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
      .set({
        state: "succeeded",
        succeeded_at: sql<Date>`coalesce(succeeded_at, ${now})`,
        updated_at: now,
        version: sql<string>`version + 1`,
      })
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

  markPaymentRetryCreated: async (tx, paymentId, now) => {
    const row = await tx
      .updateTable("payments")
      .set({ state: "created", failed_at: null, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", paymentId)
      .where("state", "in", ["failed", "expired"])
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

  requeuePaymentRefund: async (tx, paymentId, now) => {
    const row = await tx
      .updateTable("payments")
      .set({ state: "refund_pending", updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", paymentId)
      .where("state", "=", "refund_failed")
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

  markOrderAcceptedOnSettlement: async (tx, orderId, now) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({
        state: "accepted",
        payment_confirmed_at: sql<Date>`coalesce(payment_confirmed_at, ${now})`,
        accepted_at: now,
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

  requeueOrderRefund: async (tx, orderId, now) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({ state: "refund_pending", failure_code: null, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", orderId)
      .where("state", "=", "refund_failed")
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

  lockAttemptsForReconciliation: async (tx, input) => {
    const claimable = await tx
      .selectFrom("payment_attempts")
      .select("id")
      .where("checkout_channel", "=", "hosted_redirect")
      .where((expression) =>
        expression.or([
          expression("state", "=", "provider_pending"),
          expression.and([
            expression("state", "=", "created"),
            expression("checkout_expires_at", "is not", null),
            expression("checkout_expires_at", "<=", input.createdDueBefore),
          ]),
        ]),
      )
      .where((expression) => expression.or([
        expression("next_status_check_at", "is", null),
        expression("next_status_check_at", "<=", input.now),
      ]))
      .where((expression) => expression.or([
        expression("reconciliation_lease_expires_at", "is", null),
        expression("reconciliation_lease_expires_at", "<=", input.now),
      ]))
      .orderBy("created_at")
      .orderBy("id")
      .limit(input.limit)
      .forUpdate()
      .skipLocked()
      .execute()
    if (claimable.length === 0) return []
    return tx
      .updateTable("payment_attempts")
      .set({ reconciliation_lease_expires_at: input.leaseExpiresAt, updated_at: input.now })
      .where("id", "in", claimable.map((row) => row.id))
      .returningAll()
      .execute()
  },

  earliestReconciliationDueAt: async (tx, input) => {
    const result = await sql<{
      claimableCount: string
      undatedCount: string
      dueAt: Date | string | null
    }>`
      select
        count(*)::text as "claimableCount",
        (count(*) filter (where next_status_check_at is null))::text as "undatedCount",
        min(next_status_check_at) as "dueAt"
      from payment_attempts
      where checkout_channel = 'hosted_redirect'
        and (
          state = 'provider_pending'
          or (
            state = 'created'
            and checkout_expires_at is not null
            and checkout_expires_at <= ${input.createdDueBefore}
          )
        )
        and (
          reconciliation_lease_expires_at is null
          or reconciliation_lease_expires_at <= ${input.now}
        )
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined || Number(row.claimableCount) === 0) return null
    if (Number(row.undatedCount) > 0) return input.now
    if (row.dueAt === null) return input.now
    return row.dueAt instanceof Date ? row.dueAt : new Date(row.dueAt)
  },

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
