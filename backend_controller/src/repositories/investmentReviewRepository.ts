/**
 * Investment review and allocation repository (spec §5.5/§5.6, §9.3). Owns the
 * admin-side reads and writes of the review checkpoint: the pending/accepted/
 * rejected queue joining order, payment, client, selected fund, and review; the
 * guarded review/order transitions; the one private allocation per accepted
 * order; and the single contribution entry it produces in the client value
 * ledger.
 *
 * Nothing here reads or writes AUM snapshots — acceptance creates no AUM change
 * (spec §2.3), by construction.
 */
import { sql } from "kysely"

import type {
  InvestmentAllocation,
  InvestmentOrder,
  InvestmentReview,
  Payment,
  Transaction,
} from "../db/repositories.js"
import type { FundState, ReviewState } from "../db/types.js"

/** One admin queue item: payment + order + client + selected fund + review. */
export interface ReviewQueueRow {
  readonly orderId: string
  readonly userId: string
  readonly clientName: string
  readonly clientEmail: string
  readonly amountPaise: string
  readonly currency: string
  readonly fundId: string
  readonly fundName: string
  readonly fundVersionId: string
  readonly fundState: FundState
  readonly paymentId: string
  readonly paymentState: Payment["state"]
  readonly merchantOrderId: string | null
  readonly providerReference: string | null
  readonly succeededAt: Date | null
  readonly reviewId: string
  readonly reviewState: ReviewState
  readonly reasonCode: string | null
  readonly reviewedAt: Date | null
  readonly reviewVersion: string
  readonly createdAt: Date
}

export interface InsertAllocationInput {
  readonly orderId: string
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly allocatedByUserId: string
  readonly allocatedAt: Date
  readonly requestId: string
}

export interface InsertContributionInput {
  readonly userId: string
  readonly fundId: string
  readonly allocationId: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly orderId: string
  readonly paymentId: string
  readonly reasonCode: string
  readonly createdByUserId: string
  readonly requestId: string
}

export interface InvestmentReviewRepository {
  findQueuePage: (
    tx: Transaction,
    input: Readonly<{
      state: ReviewState
      afterCreatedAt?: Date
      afterId?: string
      limit: number
    }>,
  ) => Promise<readonly ReviewQueueRow[]>
  findDetailByOrder: (tx: Transaction, orderId: string) => Promise<ReviewQueueRow | null>
  lockReviewByOrder: (tx: Transaction, orderId: string) => Promise<InvestmentReview | null>
  lockOrderById: (tx: Transaction, orderId: string) => Promise<InvestmentOrder | null>
  lockPaymentByOrder: (tx: Transaction, orderId: string) => Promise<Payment | null>
  findFundState: (tx: Transaction, fundId: string) => Promise<FundState | null>
  hasAllocation: (tx: Transaction, orderId: string) => Promise<boolean>
  insertAllocation: (tx: Transaction, input: InsertAllocationInput) => Promise<InvestmentAllocation>
  /** The one contribution the accept command creates (spec §5.7 shape). */
  insertContribution: (tx: Transaction, input: InsertContributionInput) => Promise<void>
  /** pending -> accepted, setting the bank attestation and reviewer (guarded). */
  markAccepted: (
    tx: Transaction,
    input: Readonly<{
      reviewId: string
      reviewerUserId: string
      privateNote: string | null
      now: Date
    }>,
  ) => Promise<InvestmentReview | null>
  /** pending -> rejected with the public-safe reason code (guarded). */
  markRejected: (
    tx: Transaction,
    input: Readonly<{
      reviewId: string
      reviewerUserId: string
      reasonCode: string
      privateNote: string | null
      now: Date
    }>,
  ) => Promise<InvestmentReview | null>
  /** review_pending -> accepted (guarded). */
  markOrderAccepted: (tx: Transaction, orderId: string, now: Date) => Promise<InvestmentOrder | null>
  /** review_pending -> refund_pending (guarded; reject path). */
  markOrderRefundPending: (tx: Transaction, orderId: string, now: Date) => Promise<InvestmentOrder | null>
}

const QUEUE_SELECT = sql`
  select
    o.id as "orderId",
    o.user_id as "userId",
    u.full_name as "clientName",
    u.email_normalized as "clientEmail",
    o.amount_paise::text as "amountPaise",
    o.currency,
    o.fund_id as "fundId",
    fv.name as "fundName",
    o.fund_version_id as "fundVersionId",
    f.state as "fundState",
    p.id as "paymentId",
    p.state as "paymentState",
    a.merchant_order_id as "merchantOrderId",
    a.provider_order_id as "providerReference",
    p.succeeded_at as "succeededAt",
    r.id as "reviewId",
    r.state as "reviewState",
    r.reason_code as "reasonCode",
    r.reviewed_at as "reviewedAt",
    r.version::text as "reviewVersion",
    r.created_at as "createdAt"
  from investment_reviews r
  join investment_orders o on o.id = r.order_id
  join payments p on p.order_id = o.id
  join users u on u.id = o.user_id
  join funds f on f.id = o.fund_id
  join fund_versions fv on fv.id = o.fund_version_id
  left join lateral (
    select merchant_order_id, provider_order_id
    from payment_attempts pa
    where pa.payment_id = p.id
    order by pa.attempt_number desc
    limit 1
  ) a on true
`

export const createInvestmentReviewRepository = (): InvestmentReviewRepository => ({
  findQueuePage: async (tx, input) => {
    const result = await sql<ReviewQueueRow>`
      ${QUEUE_SELECT}
      where r.state = ${input.state}
        and (${input.afterCreatedAt ?? null}::timestamptz is null
             or (r.created_at, r.id) > (${input.afterCreatedAt ?? null}, ${input.afterId ?? null}))
      order by r.created_at asc, r.id asc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  findDetailByOrder: async (tx, orderId) => {
    const result = await sql<ReviewQueueRow>`
      ${QUEUE_SELECT}
      where r.order_id = ${orderId}
      limit 1
    `.execute(tx)
    return result.rows[0] ?? null
  },

  lockReviewByOrder: async (tx, orderId) => {
    const row = await tx
      .selectFrom("investment_reviews")
      .selectAll()
      .where("order_id", "=", orderId)
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

  lockPaymentByOrder: async (tx, orderId) => {
    const row = await tx
      .selectFrom("payments")
      .selectAll()
      .where("order_id", "=", orderId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  findFundState: async (tx, fundId) => {
    const row = await tx
      .selectFrom("funds")
      .select("state")
      .where("id", "=", fundId)
      .executeTakeFirst()
    return row?.state ?? null
  },

  hasAllocation: async (tx, orderId) => {
    const row = await tx
      .selectFrom("investment_allocations")
      .select("id")
      .where("order_id", "=", orderId)
      .executeTakeFirst()
    return row !== undefined
  },

  insertAllocation: async (tx, input) =>
    tx
      .insertInto("investment_allocations")
      .values({
        order_id: input.orderId,
        user_id: input.userId,
        fund_id: input.fundId,
        amount_paise: input.amountPaise,
        allocated_by_user_id: input.allocatedByUserId,
        allocated_at: input.allocatedAt,
        request_id: input.requestId,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  insertContribution: async (tx, input) => {
    await tx
      .insertInto("client_value_entries")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        allocation_id: input.allocationId,
        entry_type: "contribution",
        principal_delta_paise: input.amountPaise,
        value_delta_paise: input.amountPaise,
        effective_date: input.effectiveDate,
        order_id: input.orderId,
        payment_id: input.paymentId,
        reason_code: input.reasonCode,
        actor_type: "admin",
        created_by_user_id: input.createdByUserId,
        request_id: input.requestId,
      })
      .execute()
  },

  markAccepted: async (tx, input) => {
    const row = await tx
      .updateTable("investment_reviews")
      .set({
        state: "accepted",
        bank_verified: true,
        reviewed_by_user_id: input.reviewerUserId,
        private_note: input.privateNote,
        reviewed_at: input.now,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.reviewId)
      .where("state", "=", "pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markRejected: async (tx, input) => {
    const row = await tx
      .updateTable("investment_reviews")
      .set({
        state: "rejected",
        reviewed_by_user_id: input.reviewerUserId,
        reason_code: input.reasonCode,
        private_note: input.privateNote,
        reviewed_at: input.now,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.reviewId)
      .where("state", "=", "pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markOrderAccepted: async (tx, orderId, now) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({ state: "accepted", accepted_at: now, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", orderId)
      .where("state", "=", "review_pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markOrderRefundPending: async (tx, orderId, now) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({ state: "refund_pending", updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", orderId)
      .where("state", "=", "review_pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },
})
