/**
 * Refund-operations repository (spec §5.3). A rejected succeeded payment gets
 * one first-class refund row whose stable merchant refund id is persisted
 * before any provider call and reused for crash recovery and reconciliation.
 * Transitions are guarded UPDATEs so duplicate provider outcomes and admin
 * retries cannot double-apply.
 */
import { sql } from "kysely"

import type { RefundOperation, Transaction } from "../db/repositories.js"
import type { RefundState } from "../db/types.js"

export interface CreateRefundInput {
  readonly paymentId: string
  readonly orderId: string
  readonly merchantRefundId: string
  readonly amountPaise: string
  readonly createdByUserId: string
  readonly requestId: string
}

export interface RefundListRow {
  readonly id: string
  readonly orderId: string
  readonly paymentId: string
  readonly merchantRefundId: string
  readonly providerRefundId: string | null
  readonly amountPaise: string
  readonly state: RefundState
  readonly failureCode: string | null
  readonly attemptCount: number
  readonly lastStatusCheckedAt: Date | null
  readonly clientName: string
  readonly clientEmail: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** Refund states from which provider evidence may still move the row. */
const REFUND_OPEN_STATES = ["pending", "provider_pending"] as const

export interface RefundRepository {
  create: (tx: Transaction, input: CreateRefundInput) => Promise<RefundOperation>
  lockById: (tx: Transaction, refundId: string) => Promise<RefundOperation | null>
  lockByMerchantRefundId: (
    tx: Transaction,
    merchantRefundId: string,
  ) => Promise<RefundOperation | null>
  listPage: (
    tx: Transaction,
    input: Readonly<{
      states: readonly RefundState[]
      afterCreatedAt?: Date
      afterId?: string
      limit: number
    }>,
  ) => Promise<readonly RefundListRow[]>
  /** pending -> provider_pending after dispatch; bumps the attempt count. */
  markProviderPending: (
    tx: Transaction,
    input: Readonly<{ refundId: string; providerRefundId: string | null; now: Date }>,
  ) => Promise<RefundOperation | null>
  markRefunded: (
    tx: Transaction,
    input: Readonly<{ refundId: string; providerRefundId: string | null; now: Date }>,
  ) => Promise<RefundOperation | null>
  markFailed: (
    tx: Transaction,
    input: Readonly<{ refundId: string; failureCode: string; now: Date }>,
  ) => Promise<RefundOperation | null>
  markStatusChecked: (
    tx: Transaction,
    input: Readonly<{ refundId: string; now: Date }>,
  ) => Promise<void>
  /** Admin retry: failed -> pending so the worker dispatches the same stable id. */
  requeue: (tx: Transaction, refundId: string, now: Date) => Promise<RefundOperation | null>
  /** Worker claim: open refunds, oldest first, locked SKIP LOCKED. */
  lockDueRefunds: (
    tx: Transaction,
    input: Readonly<{ limit: number }>,
  ) => Promise<readonly RefundOperation[]>
}

export const createRefundRepository = (): RefundRepository => ({
  create: async (tx, input) =>
    tx
      .insertInto("refund_operations")
      .values({
        payment_id: input.paymentId,
        order_id: input.orderId,
        merchant_refund_id: input.merchantRefundId,
        amount_paise: input.amountPaise,
        created_by_user_id: input.createdByUserId,
        request_id: input.requestId,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  lockById: async (tx, refundId) => {
    const row = await tx
      .selectFrom("refund_operations")
      .selectAll()
      .where("id", "=", refundId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  lockByMerchantRefundId: async (tx, merchantRefundId) => {
    const row = await tx
      .selectFrom("refund_operations")
      .selectAll()
      .where("merchant_refund_id", "=", merchantRefundId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  listPage: async (tx, input) => {
    const result = await sql<RefundListRow>`
      select
        r.id,
        r.order_id as "orderId",
        r.payment_id as "paymentId",
        r.merchant_refund_id as "merchantRefundId",
        r.provider_refund_id as "providerRefundId",
        r.amount_paise::text as "amountPaise",
        r.state,
        r.failure_code as "failureCode",
        r.attempt_count as "attemptCount",
        r.last_status_checked_at as "lastStatusCheckedAt",
        u.full_name as "clientName",
        u.email_normalized as "clientEmail",
        r.created_at as "createdAt",
        r.updated_at as "updatedAt"
      from refund_operations r
      join payments p on p.id = r.payment_id
      join users u on u.id = p.user_id
      where (${input.states.length} = 0 or r.state = any(${input.states}))
        and (${input.afterCreatedAt ?? null}::timestamptz is null
             or (r.created_at, r.id) < (${input.afterCreatedAt ?? null}, ${input.afterId ?? null}))
      order by r.created_at desc, r.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  markProviderPending: async (tx, input) => {
    const row = await tx
      .updateTable("refund_operations")
      .set({
        state: "provider_pending",
        provider_refund_id: input.providerRefundId,
        attempt_count: sql<number>`attempt_count + 1`,
        updated_at: input.now,
      })
      .where("id", "=", input.refundId)
      .where("state", "=", "pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markRefunded: async (tx, input) => {
    const row = await tx
      .updateTable("refund_operations")
      .set({
        state: "refunded",
        provider_refund_id: input.providerRefundId,
        last_status_checked_at: input.now,
        updated_at: input.now,
      })
      .where("id", "=", input.refundId)
      .where("state", "in", REFUND_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markFailed: async (tx, input) => {
    const row = await tx
      .updateTable("refund_operations")
      .set({
        state: "failed",
        failure_code: input.failureCode,
        last_status_checked_at: input.now,
        updated_at: input.now,
      })
      .where("id", "=", input.refundId)
      .where("state", "in", REFUND_OPEN_STATES)
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markStatusChecked: async (tx, input) => {
    await tx
      .updateTable("refund_operations")
      .set({ last_status_checked_at: input.now, updated_at: input.now })
      .where("id", "=", input.refundId)
      .execute()
  },

  requeue: async (tx, refundId, now) => {
    const row = await tx
      .updateTable("refund_operations")
      .set({ state: "pending", failure_code: null, updated_at: now })
      .where("id", "=", refundId)
      .where("state", "=", "failed")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  lockDueRefunds: async (tx, input) =>
    tx
      .selectFrom("refund_operations")
      .selectAll()
      .where("state", "in", REFUND_OPEN_STATES)
      .orderBy("created_at")
      .orderBy("id")
      .limit(input.limit)
      .forUpdate()
      .skipLocked()
      .execute(),
})
