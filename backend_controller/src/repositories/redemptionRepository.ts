/**
 * Redemption repository — Option B money shape (migration 021).
 *
 * A request records an amount and how it splits between principal and returns.
 * Settling one is what actually moves money: the administrator approves, the
 * payout is appended to the investor's ledger, and the request records what was
 * settled. Requests are never deleted.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { RedemptionMode, RedemptionState } from "../db/types.js"

export interface RedemptionRequestRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly fundSlug: string | null
  readonly state: RedemptionState
  readonly mode: RedemptionMode | null
  readonly requestedAmountPaise: string | null
  readonly principalComponentPaise: string | null
  readonly returnsComponentPaise: string | null
  readonly settledAmountPaise: string | null
  readonly reasonCode: string | null
  readonly submittedAt: Date | null
  readonly approvedAt: Date | null
  readonly settledAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}

export interface CreateRedemptionInput {
  readonly userId: string
  readonly fundId: string
  readonly mode: RedemptionMode
  readonly requestedAmountPaise: string
  readonly principalComponentPaise: string
  readonly returnsComponentPaise: string
  /** Active policy version this request was priced under (FK). */
  readonly financePolicyVersion: number
  readonly now: Date
}

export interface RedemptionWriteRepository {
  /** The active finance policy version; null when none has been published. */
  activePolicyVersion: (tx: Transaction) => Promise<number | null>
  create: (tx: Transaction, input: CreateRedemptionInput) => Promise<RedemptionRequestRow>
  listByUser: (tx: Transaction, userId: string, limit: number) => Promise<readonly RedemptionRequestRow[]>
  /** An undecided request blocks a second one for the same pool. */
  findOpenByUserAndFund: (
    tx: Transaction,
    userId: string,
    fundId: string,
  ) => Promise<RedemptionRequestRow | null>
  lockById: (tx: Transaction, id: string) => Promise<RedemptionRequestRow | null>
  markSettled: (
    tx: Transaction,
    input: { readonly id: string; readonly settledAmountPaise: string; readonly now: Date },
  ) => Promise<RedemptionRequestRow>
  markRejected: (
    tx: Transaction,
    input: { readonly id: string; readonly reasonCode: string; readonly now: Date },
  ) => Promise<RedemptionRequestRow>
}

const COLUMNS = sql`
  r.id as "id",
  r.user_id as "userId",
  r.fund_id as "fundId",
  f.slug as "fundSlug",
  r.state as "state",
  r.mode as "mode",
  r.requested_amount_paise::text as "requestedAmountPaise",
  r.principal_component_paise::text as "principalComponentPaise",
  r.returns_component_paise::text as "returnsComponentPaise",
  r.settled_amount_paise::text as "settledAmountPaise",
  r.reason_code as "reasonCode",
  r.submitted_at as "submittedAt",
  r.approved_at as "approvedAt",
  r.settled_at as "settledAt",
  r.created_at as "createdAt",
  r.updated_at as "updatedAt",
  r.version::text as "version"
`

const reload = async (tx: Transaction, id: string): Promise<RedemptionRequestRow> => {
  const result = await sql<RedemptionRequestRow>`
    select ${COLUMNS} from redemption_requests r
    left join funds f on f.id = r.fund_id
    where r.id = ${id}
  `.execute(tx)
  const row = result.rows[0]
  if (row === undefined) throw new Error("redemption_requests row disappeared")
  return row
}

export const createRedemptionRepository = (): RedemptionWriteRepository => ({
  activePolicyVersion: async (tx) => {
    const result = await sql<{ version: number }>`
      select version from finance_policy_versions where retired_at is null order by version desc limit 1
    `.execute(tx)
    const row = result.rows[0]
    return row === undefined ? null : Number(row.version)
  },

  create: async (tx, input) => {
    // `order_id` is the legacy unit-era link; the money model books the payout on
    // the ledger instead, so a redemption request stands on its own order row.
    const order = await sql<{ id: string }>`
      insert into investment_orders (user_id, fund_id, type, state, amount_paise, requested_at)
      values (${input.userId}, ${input.fundId}, 'redemption', 'submitted',
              ${input.requestedAmountPaise}::bigint, ${input.now})
      returning id
    `.execute(tx)
    const orderId = order.rows[0]?.id
    if (orderId === undefined) throw new Error("redemption order insert returned no row")

    const inserted = await sql<{ id: string }>`
      insert into redemption_requests (
        order_id, user_id, fund_id, state, mode, requested_amount_paise,
        principal_component_paise, returns_component_paise, finance_policy_version,
        requires_dual_approval, submitted_at
      ) values (
        ${orderId}, ${input.userId}, ${input.fundId}, 'submitted', ${input.mode},
        ${input.requestedAmountPaise}::bigint, ${input.principalComponentPaise}::bigint,
        ${input.returnsComponentPaise}::bigint,
        ${input.financePolicyVersion}, false, ${input.now}
      )
      returning id
    `.execute(tx)
    const id = inserted.rows[0]?.id
    if (id === undefined) throw new Error("redemption_requests insert returned no row")
    return reload(tx, id)
  },

  listByUser: async (tx, userId, limit) => {
    const result = await sql<RedemptionRequestRow>`
      select ${COLUMNS} from redemption_requests r
      left join funds f on f.id = r.fund_id
      where r.user_id = ${userId}
      order by r.created_at desc
      limit ${limit}
    `.execute(tx)
    return result.rows
  },

  findOpenByUserAndFund: async (tx, userId, fundId) => {
    const result = await sql<RedemptionRequestRow>`
      select ${COLUMNS} from redemption_requests r
      left join funds f on f.id = r.fund_id
      where r.user_id = ${userId} and r.fund_id = ${fundId}
        and r.state in ('submitted', 'units_reserved', 'approved', 'settlement_pending')
      limit 1
    `.execute(tx)
    return result.rows[0] ?? null
  },

  lockById: async (tx, id) => {
    const locked = await sql<{ id: string }>`
      select id from redemption_requests where id = ${id} for update
    `.execute(tx)
    if (locked.rows[0] === undefined) return null
    return reload(tx, id)
  },

  markSettled: async (tx, input) => {
    await sql`
      update redemption_requests set
        state = 'settled',
        approved_at = coalesce(approved_at, ${input.now}),
        settled_at = ${input.now},
        settled_amount_paise = ${input.settledAmountPaise}::bigint,
        updated_at = now(),
        version = version + 1
      where id = ${input.id}
    `.execute(tx)
    return reload(tx, input.id)
  },

  markRejected: async (tx, input) => {
    await sql`
      update redemption_requests set
        state = 'rejected',
        reason_code = ${input.reasonCode},
        updated_at = now(),
        version = version + 1
      where id = ${input.id}
    `.execute(tx)
    return reload(tx, input.id)
  },
})
