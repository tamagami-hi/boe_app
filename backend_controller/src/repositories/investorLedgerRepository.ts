/**
 * Investor ledger repository (Option B). The ledger is the authoritative record
 * of an investor's money: contributions, redemptions, and administrator-allocated
 * gains, each as one dated append-only row. Nothing here updates a balance —
 * balances are derived by `domain/client/portfolioLedger.ts`.
 *
 * Money is `bigint` paise and crosses this boundary as a string. Reads return
 * whole ledgers (per user, or per user+fund) because derivation is a fold over
 * every entry: there is no incremental balance to trust instead.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { LedgerEntryType } from "../db/types.js"

export interface LedgerEntryRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly entryType: LedgerEntryType
  readonly principalDeltaPaise: string
  readonly valueDeltaPaise: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly orderId: string | null
  readonly paymentId: string | null
  readonly redemptionRequestId: string | null
  readonly allocatedByUserId: string | null
  readonly reasonCode: string | null
  readonly note: string | null
  readonly createdAt: Date
}

export interface AppendLedgerEntryInput {
  readonly userId: string
  readonly fundId: string
  readonly entryType: LedgerEntryType
  readonly principalDeltaPaise: string
  readonly valueDeltaPaise: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly orderId?: string | null
  readonly paymentId?: string | null
  readonly redemptionRequestId?: string | null
  readonly allocatedByUserId?: string | null
  readonly reasonCode?: string | null
  readonly note?: string | null
  readonly requestId: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface FundLedgerTotalsRow {
  readonly fundId: string
  readonly investorCount: number
  readonly contributionsPaise: string
  readonly redemptionsPaise: string
  readonly allocatedGainPaise: string
  readonly currentValuePaise: string
}

export interface InvestorLedgerRepository {
  append: (tx: Transaction, input: AppendLedgerEntryInput) => Promise<LedgerEntryRow>
  listByUser: (tx: Transaction, userId: string) => Promise<readonly LedgerEntryRow[]>
  listByUserAndFund: (
    tx: Transaction,
    userId: string,
    fundId: string,
  ) => Promise<readonly LedgerEntryRow[]>
  /** Recent activity for the investor's transaction list, newest first. */
  listRecentByUser: (tx: Transaction, userId: string, limit: number) => Promise<readonly LedgerEntryRow[]>
  existsForPayment: (tx: Transaction, paymentId: string) => Promise<boolean>
  /**
   * Every entry in a pool, with the investor's identity, oldest first. The admin
   * pool view derives each investor's position from these with the same pure
   * function the client dashboard uses, so the two can never disagree.
   */
  listByFundWithInvestors: (
    tx: Transaction,
    fundId: string,
  ) => Promise<readonly FundInvestorLedgerRow[]>
  /** Pool-level rollup across all investors, for the admin fund view. */
  fundTotals: (tx: Transaction, fundId: string) => Promise<FundLedgerTotalsRow>
}

/** A pool entry joined to the investor it belongs to. */
export interface FundInvestorLedgerRow extends LedgerEntryRow {
  readonly investorName: string
  readonly investorEmail: string
  readonly accountState: string
}

const LEDGER_COLUMNS = sql`
  id as "id",
  user_id as "userId",
  fund_id as "fundId",
  entry_type as "entryType",
  principal_delta_paise::text as "principalDeltaPaise",
  value_delta_paise::text as "valueDeltaPaise",
  amount_paise::text as "amountPaise",
  effective_date::text as "effectiveDate",
  order_id as "orderId",
  payment_id as "paymentId",
  redemption_request_id as "redemptionRequestId",
  allocated_by_user_id as "allocatedByUserId",
  reason_code as "reasonCode",
  note as "note",
  created_at as "createdAt"
`

export const createInvestorLedgerRepository = (): InvestorLedgerRepository => ({
  append: async (tx, input) => {
    const result = await sql<LedgerEntryRow>`
      insert into investor_ledger_entries (
        user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, amount_paise,
        effective_date, order_id, payment_id, redemption_request_id, allocated_by_user_id,
        reason_code, note, request_id, metadata
      ) values (
        ${input.userId}, ${input.fundId}, ${input.entryType},
        ${input.principalDeltaPaise}::bigint, ${input.valueDeltaPaise}::bigint,
        ${input.amountPaise}::bigint, ${input.effectiveDate}::date,
        ${input.orderId ?? null}, ${input.paymentId ?? null}, ${input.redemptionRequestId ?? null},
        ${input.allocatedByUserId ?? null}, ${input.reasonCode ?? null}, ${input.note ?? null},
        ${input.requestId}, ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
      returning ${LEDGER_COLUMNS}
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("investor_ledger_entries insert returned no row")
    return row
  },

  listByUser: async (tx, userId) => {
    const result = await sql<LedgerEntryRow>`
      select ${LEDGER_COLUMNS} from investor_ledger_entries
      where user_id = ${userId}
      order by effective_date asc, created_at asc, id asc
    `.execute(tx)
    return result.rows
  },

  listByUserAndFund: async (tx, userId, fundId) => {
    const result = await sql<LedgerEntryRow>`
      select ${LEDGER_COLUMNS} from investor_ledger_entries
      where user_id = ${userId} and fund_id = ${fundId}
      order by effective_date asc, created_at asc, id asc
    `.execute(tx)
    return result.rows
  },

  listRecentByUser: async (tx, userId, limit) => {
    const result = await sql<LedgerEntryRow>`
      select ${LEDGER_COLUMNS} from investor_ledger_entries
      where user_id = ${userId}
      order by effective_date desc, created_at desc, id desc
      limit ${limit}
    `.execute(tx)
    return result.rows
  },

  listByFundWithInvestors: async (tx, fundId) => {
    const result = await sql<FundInvestorLedgerRow>`
      select
        e.id as "id",
        e.user_id as "userId",
        e.fund_id as "fundId",
        e.entry_type as "entryType",
        e.principal_delta_paise::text as "principalDeltaPaise",
        e.value_delta_paise::text as "valueDeltaPaise",
        e.amount_paise::text as "amountPaise",
        e.effective_date::text as "effectiveDate",
        e.order_id as "orderId",
        e.payment_id as "paymentId",
        e.redemption_request_id as "redemptionRequestId",
        e.allocated_by_user_id as "allocatedByUserId",
        e.reason_code as "reasonCode",
        e.note as "note",
        e.created_at as "createdAt",
        u.full_name as "investorName",
        u.email_normalized as "investorEmail",
        u.account_state as "accountState"
      from investor_ledger_entries e
      join users u on u.id = e.user_id
      where e.fund_id = ${fundId}
      order by e.effective_date asc, e.created_at asc, e.id asc
    `.execute(tx)
    return result.rows
  },

  existsForPayment: async (tx, paymentId) => {
    const result = await sql<{ exists: boolean }>`
      select exists(
        select 1 from investor_ledger_entries where payment_id = ${paymentId}
      ) as "exists"
    `.execute(tx)
    return result.rows[0]?.exists === true
  },

  fundTotals: async (tx, fundId) => {
    const result = await sql<FundLedgerTotalsRow>`
      select
        ${fundId}::uuid as "fundId",
        count(distinct user_id)::int as "investorCount",
        coalesce(sum(case when entry_type in ('sip_installment','lump_sum')
                          then amount_paise else 0 end), 0)::text as "contributionsPaise",
        coalesce(sum(case when entry_type = 'redemption'
                          then amount_paise else 0 end), 0)::text as "redemptionsPaise",
        coalesce(sum(case when entry_type = 'gain_allocation'
                          then value_delta_paise else 0 end), 0)::text as "allocatedGainPaise",
        coalesce(sum(value_delta_paise), 0)::text as "currentValuePaise"
      from investor_ledger_entries
      where fund_id = ${fundId}
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("fund ledger totals returned no row")
    return row
  },
})
