import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export interface ClientValueUpdateRow {
  readonly id: string
  readonly fundId: string
  readonly fundName: string
  readonly effectiveDate: string
  readonly changePaise: string
  readonly valueAfterPaise: string
  readonly createdAt: Date
  readonly cursorAt: string
}

export interface ClientValueUpdatePageQuery {
  readonly userId: string
  readonly limit: number
  readonly afterCursorAt?: string
  readonly afterId?: string
}

export interface ClientValueUpdateRepository {
  listByUser: (
    tx: Transaction,
    query: ClientValueUpdatePageQuery,
  ) => Promise<readonly ClientValueUpdateRow[]>
}

export const createClientValueUpdateRepository = (): ClientValueUpdateRepository => ({
  listByUser: async (tx, query) => {
    const afterCursorAt = query.afterCursorAt ?? null
    const afterId = query.afterId ?? null
    const result = await sql<ClientValueUpdateRow>`
      with visible as (
        select e.id, e.fund_id, e.entry_type, e.effective_date, e.value_delta_paise, e.created_at
        from client_value_entries e
        where e.user_id = ${query.userId}
          and e.entry_type <> 'reversal'
          and not exists (
            select 1 from client_value_entries r where r.reverses_entry_id = e.id
          )
      ),
      running as (
        select
          v.*,
          sum(v.value_delta_paise) over (
            partition by v.fund_id
            order by v.created_at asc, v.id asc
            rows between unbounded preceding and current row
          ) as value_after_paise
        from visible v
      )
      select
        r.id,
        r.fund_id as "fundId",
        coalesce(fv.name, f.slug) as "fundName",
        r.effective_date::text as "effectiveDate",
        r.value_delta_paise::text as "changePaise",
        r.value_after_paise::text as "valueAfterPaise",
        r.created_at as "createdAt",
        to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt"
      from running r
      join funds f on f.id = r.fund_id
      left join fund_versions fv on fv.id = f.current_published_version_id
      where r.entry_type = 'growth_adjustment'
        and (${afterCursorAt}::timestamptz is null
             or (r.created_at, r.id) < (${afterCursorAt}::timestamptz, ${afterId}::uuid))
      order by r.created_at desc, r.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },
})
