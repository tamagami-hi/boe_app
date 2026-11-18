import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import { cursorTime, keysetCondition, type KeysetBoundary, type WithCursor } from "./keysetBoundary.js"

export interface ClientBalanceRow {
  readonly userId: string
  readonly fundId: string
  readonly clientName: string
  readonly clientEmail: string
  readonly fundName: string
  readonly investedPaise: string
  readonly valuePaise: string
}

export interface MonthContributionRow {
  readonly entryId: string
  readonly userId: string
  readonly clientName: string
  readonly clientEmail: string
  readonly fundId: string
  readonly fundName: string
  readonly orderType: string | null
  readonly reasonCode: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly recordedAt: Date
  readonly reversedAt: Date | null
  readonly sipLinked: boolean
  readonly oneTime: boolean
}

export interface ClientBalanceQuery {
  readonly asOfDate: string
  readonly limit: number
  readonly after: Readonly<{ userId: string; fundId: string }> | null
}

export interface MonthContributionQuery extends KeysetBoundary {
  readonly monthStart: string
  readonly limit: number
}

export interface AccountingReportRepository {
  listClientBalances: (tx: Transaction, query: ClientBalanceQuery) => Promise<readonly ClientBalanceRow[]>
  listMonthContributions: (
    tx: Transaction,
    query: MonthContributionQuery,
  ) => Promise<readonly WithCursor<MonthContributionRow>[]>
}

const CLIENT_COLUMNS = sql`
  case when u.pii_tombstoned_at is null then u.full_name else 'Tombstoned' end as "clientName",
  case when u.pii_tombstoned_at is null then u.email_normalized
       else 'tombstone+' || replace(u.id::text, '-', '') || '@invalid.example' end as "clientEmail",
  coalesce(fv.name, f.slug) as "fundName"
`

export const createAccountingReportRepository = (): AccountingReportRepository => ({
  listClientBalances: async (tx, query) => {
    const afterUserId = query.after?.userId ?? null
    const afterFundId = query.after?.fundId ?? null
    const result = await sql<ClientBalanceRow>`
      select
        e.user_id as "userId",
        e.fund_id as "fundId",
        ${CLIENT_COLUMNS},
        sum(e.principal_delta_paise)::text as "investedPaise",
        sum(e.value_delta_paise)::text as "valuePaise"
      from client_value_entries e
      join users u on u.id = e.user_id
      join funds f on f.id = e.fund_id
      left join fund_versions fv on fv.id = f.current_published_version_id
      where e.effective_date <= ${query.asOfDate}::date
        and (${afterUserId}::uuid is null
             or (e.user_id, e.fund_id) > (${afterUserId}::uuid, ${afterFundId}::uuid))
      group by e.user_id, e.fund_id, u.id, f.id, fv.id
      order by e.user_id asc, e.fund_id asc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  listMonthContributions: async (tx, query) => {
    const result = await sql<WithCursor<MonthContributionRow>>`
      select
        e.id as "entryId",
        e.user_id as "userId",
        e.fund_id as "fundId",
        ${CLIENT_COLUMNS},
        o.type::text as "orderType",
        e.reason_code as "reasonCode",
        e.principal_delta_paise::text as "amountPaise",
        to_char(e.effective_date, 'YYYY-MM-DD') as "effectiveDate",
        e.created_at as "recordedAt",
        r.created_at as "reversedAt",
        exists (select 1 from admin_sip_schedule_months l where l.entry_id = e.id) as "sipLinked",
        exists (select 1 from client_value_entry_categories c where c.entry_id = e.id) as "oneTime",
        ${cursorTime("e.created_at")} as "cursorAt"
      from client_value_entries e
      join users u on u.id = e.user_id
      join funds f on f.id = e.fund_id
      left join fund_versions fv on fv.id = f.current_published_version_id
      left join investment_orders o on o.id = e.order_id
      left join client_value_entries r on r.reverses_entry_id = e.id
      where e.entry_type = 'contribution'
        and e.effective_date >= ${query.monthStart}::date
        and e.effective_date < (${query.monthStart}::date + interval '1 month')
        and ${keysetCondition({ time: "e.created_at", id: "e.id" }, "after", query)}
      order by e.created_at asc, e.id asc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },
})
