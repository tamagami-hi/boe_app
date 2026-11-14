import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export interface ClientInvestedFundRow {
  readonly fundId: string
  readonly fundName: string
  readonly fundPublished: boolean
}

export interface ClientInvestedFundRepository {
  listByUser: (tx: Transaction, userId: string) => Promise<readonly ClientInvestedFundRow[]>
  findByUser: (tx: Transaction, input: Readonly<{ userId: string; fundId: string }>) => Promise<ClientInvestedFundRow | null>
}

const INVESTED_FUND_SELECTION = sql`
  select
    f.id as "fundId",
    coalesce(fv.name, f.slug) as "fundName",
    (f.state = 'published' and f.current_published_version_id is not null) as "fundPublished"
  from funds f
  left join fund_versions fv on fv.id = f.current_published_version_id
`

const heldBy = (userId: string) => sql`
  exists (select 1 from client_value_entries e where e.user_id = ${userId} and e.fund_id = f.id)
`

export const createClientInvestedFundRepository = (): ClientInvestedFundRepository => ({
  listByUser: async (tx, userId) => {
    const result = await sql<ClientInvestedFundRow>`
      ${INVESTED_FUND_SELECTION}
      where ${heldBy(userId)}
      order by "fundName" asc, f.id asc
    `.execute(tx)
    return result.rows
  },

  findByUser: async (tx, input) => {
    const result = await sql<ClientInvestedFundRow>`
      ${INVESTED_FUND_SELECTION}
      where f.id = ${input.fundId} and ${heldBy(input.userId)}
    `.execute(tx)
    return result.rows[0] ?? null
  },
})
