/**
 * Client value-entry read repository (spec §5.7). `client_value_entries` is the
 * client-visible value ledger; this repository exposes only the client-safe
 * columns. Admin-only provenance columns (`allocation_id`, `note`,
 * `reason_code`, `created_by_user_id`, and friends) are intentionally never
 * selected here — client routes serialize exactly what this returns.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { ClientValueEntryType } from "../db/types.js"

export interface ClientValueEntryRow {
  readonly id: string
  readonly fundId: string
  readonly entryType: ClientValueEntryType
  readonly principalDeltaPaise: string
  readonly valueDeltaPaise: string
  readonly effectiveDate: string
  readonly orderId: string | null
  readonly createdAt: Date
}

export interface ClientValueEntryRepository {
  listByUser: (tx: Transaction, userId: string) => Promise<readonly ClientValueEntryRow[]>
  listRecentByUser: (
    tx: Transaction,
    userId: string,
    limit: number,
  ) => Promise<readonly ClientValueEntryRow[]>
}

const ENTRY_COLUMNS = sql`
  id,
  fund_id as "fundId",
  entry_type as "entryType",
  principal_delta_paise::text as "principalDeltaPaise",
  value_delta_paise::text as "valueDeltaPaise",
  effective_date::text as "effectiveDate",
  order_id as "orderId",
  created_at as "createdAt"
`

export const createClientValueEntryRepository = (): ClientValueEntryRepository => ({
  listByUser: async (tx, userId) => {
    const result = await sql<ClientValueEntryRow>`
      select ${ENTRY_COLUMNS}
      from client_value_entries
      where user_id = ${userId}
      order by effective_date asc, created_at asc, id asc
    `.execute(tx)
    return result.rows
  },

  listRecentByUser: async (tx, userId, limit) => {
    const result = await sql<ClientValueEntryRow>`
      select ${ENTRY_COLUMNS}
      from client_value_entries
      where user_id = ${userId}
      order by created_at desc, id desc
      limit ${limit}
    `.execute(tx)
    return result.rows
  },
})
