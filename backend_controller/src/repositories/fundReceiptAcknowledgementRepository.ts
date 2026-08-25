import { sql } from "kysely"

import type {
  InvestmentOrder,
  FundReceiptAcknowledgement,
  Payment,
  Transaction,
} from "../db/repositories.js"
import type { FundReceiptAcknowledgementState, FundState } from "../db/types.js"

export interface FundReceiptQueueRow {
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
  readonly acknowledgementId: string
  readonly acknowledgementState: FundReceiptAcknowledgementState
  readonly acknowledgedAt: Date | null
  readonly privateNote: string | null
  readonly acknowledgementVersion: string
  readonly createdAt: Date
}

export interface FundReceiptAcknowledgementRepository {
  findQueuePage: (
    tx: Transaction,
    input: Readonly<{
      state: FundReceiptAcknowledgementState
      afterCreatedAt?: Date
      afterId?: string
      limit: number
    }>,
  ) => Promise<readonly FundReceiptQueueRow[]>
  findDetailByOrder: (tx: Transaction, orderId: string) => Promise<FundReceiptQueueRow | null>
  lockAcknowledgementByOrder: (tx: Transaction, orderId: string) => Promise<FundReceiptAcknowledgement | null>
  lockOrderById: (tx: Transaction, orderId: string) => Promise<InvestmentOrder | null>
  lockPaymentByOrder: (tx: Transaction, orderId: string) => Promise<Payment | null>
  markAcknowledged: (
    tx: Transaction,
    input: Readonly<{
      acknowledgementId: string
      acknowledgedByUserId: string
      privateNote: string | null
      now: Date
    }>,
  ) => Promise<FundReceiptAcknowledgement | null>
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
    r.id as "acknowledgementId",
    r.state as "acknowledgementState",
    r.acknowledged_at as "acknowledgedAt",
    r.private_note as "privateNote",
    r.version::text as "acknowledgementVersion",
    r.created_at as "createdAt"
  from fund_receipt_acknowledgements r
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

export const createFundReceiptAcknowledgementRepository = (): FundReceiptAcknowledgementRepository => ({
  findQueuePage: async (tx, input) => {
    const result = await sql<FundReceiptQueueRow>`
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
    const result = await sql<FundReceiptQueueRow>`
      ${QUEUE_SELECT}
      where r.order_id = ${orderId}
      limit 1
    `.execute(tx)
    return result.rows[0] ?? null
  },

  lockAcknowledgementByOrder: async (tx, orderId) => {
    const row = await tx
      .selectFrom("fund_receipt_acknowledgements")
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

  markAcknowledged: async (tx, input) => {
    const row = await tx
      .updateTable("fund_receipt_acknowledgements")
      .set({
        state: "acknowledged",
        acknowledged_by_user_id: input.acknowledgedByUserId,
        private_note: input.privateNote,
        acknowledged_at: input.now,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.acknowledgementId)
      .where("state", "=", "pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },
})
