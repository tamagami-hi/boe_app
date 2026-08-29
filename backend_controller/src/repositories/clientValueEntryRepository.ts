/**
 * Client value-entry read repository (spec §5.7). `client_value_entries` is the
 * client-visible value ledger; this repository exposes only the client-safe
 * columns. Admin-only provenance columns (`allocation_id`, `note`,
 * `reason_code`, `created_by_user_id`, and friends) are intentionally never
 * selected here — client routes serialize exactly what this returns.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { ClientValueEntryType, OrderType } from "../db/types.js"

export interface ClientValueEntryRow {
  readonly id: string
  readonly fundId: string
  readonly entryType: ClientValueEntryType
  readonly principalDeltaPaise: string
  readonly valueDeltaPaise: string
  readonly effectiveDate: string
  readonly orderId: string | null
  readonly orderType: OrderType | null
  readonly createdAt: Date
}

export interface ClientValueEntryRepository {
  listByUser: (tx: Transaction, userId: string) => Promise<readonly ClientValueEntryRow[]>
  listRecentByUser: (
    tx: Transaction,
    input: Readonly<{ userId: string; limit: number; afterCreatedAt?: Date; afterId?: string }>,
  ) => Promise<readonly ClientValueEntryRow[]>
}

const ENTRY_COLUMNS = sql`
  v.id,
  v.fund_id as "fundId",
  v.entry_type as "entryType",
  v.principal_delta_paise::text as "principalDeltaPaise",
  v.value_delta_paise::text as "valueDeltaPaise",
  v.effective_date::text as "effectiveDate",
  v.order_id as "orderId",
  v.created_at as "createdAt",
  o.type as "orderType"
`

export const createClientValueEntryRepository = (): ClientValueEntryRepository => ({
  listByUser: async (tx, userId) => {
    const result = await sql<ClientValueEntryRow>`
      select ${ENTRY_COLUMNS}
      from client_value_entries v
      left join investment_orders o on o.id = v.order_id
      where v.user_id = ${userId}
      order by v.effective_date asc, v.created_at asc, v.id asc
    `.execute(tx)
    return result.rows
  },

  listRecentByUser: async (tx, input) => {
    const result = await sql<ClientValueEntryRow>`
      select ${ENTRY_COLUMNS}
      from client_value_entries v
      left join investment_orders o on o.id = v.order_id
      where v.user_id = ${input.userId}
        and (${input.afterCreatedAt ?? null}::timestamptz is null
             or (v.created_at, v.id) < (${input.afterCreatedAt ?? null}, ${input.afterId ?? null}))
      order by v.created_at desc, v.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },
})
