import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { ClientValueEntryType } from "../db/types.js"
import type { LedgerFact } from "../domain/admin/clientReturns.js"
import { isPendingInvite } from "./userSegments.js"

export interface UserLedgerFact extends LedgerFact {
  readonly userId: string
}

export interface FundValueUpdateRow {
  readonly fundId: string
  readonly fundSlug: string
  readonly fundName: string | null
  readonly lastValueUpdateAt: Date | null
  readonly lastValueUpdateEffectiveDate: string | null
}

export interface PendingInvites {
  readonly count: number
  readonly oldestInvitedAt: Date | null
}

export interface ClientReturnsRepository {
  listLedgerFacts: (tx: Transaction, userIds: readonly string[] | null) => Promise<readonly UserLedgerFact[]>
  listExistingUserIds: (tx: Transaction, userIds: readonly string[]) => Promise<readonly string[]>
  listFundValueUpdates: (tx: Transaction) => Promise<readonly FundValueUpdateRow[]>
  countPendingInvites: (tx: Transaction) => Promise<PendingInvites>
}

interface LedgerFactSqlRow {
  readonly userId: string
  readonly entryType: ClientValueEntryType
  readonly reversedEntryType: ClientValueEntryType | null
  readonly effectiveDate: string
  readonly principalDeltaPaise: string
  readonly valueDeltaPaise: string
  readonly lastCreatedAt: Date
}

export const createClientReturnsRepository = (): ClientReturnsRepository => ({
  listLedgerFacts: async (tx, userIds) => {
    const result = await sql<LedgerFactSqlRow>`
      select
        e.user_id as "userId",
        e.entry_type as "entryType",
        r.entry_type as "reversedEntryType",
        to_char(e.effective_date, 'YYYY-MM-DD') as "effectiveDate",
        sum(e.principal_delta_paise)::text as "principalDeltaPaise",
        sum(e.value_delta_paise)::text as "valueDeltaPaise",
        max(e.created_at) as "lastCreatedAt"
      from client_value_entries e
      left join client_value_entries r on r.id = e.reverses_entry_id
      where ${userIds === null ? sql`true` : sql`e.user_id = any(${[...userIds]}::uuid[])`}
      group by e.user_id, e.entry_type, r.entry_type, e.effective_date
    `.execute(tx)
    return result.rows.map((row) => ({
      userId: row.userId,
      entryType: row.entryType,
      reversedEntryType: row.reversedEntryType,
      effectiveDate: row.effectiveDate,
      principalDeltaPaise: BigInt(row.principalDeltaPaise),
      valueDeltaPaise: BigInt(row.valueDeltaPaise),
      lastCreatedAt: new Date(row.lastCreatedAt),
    }))
  },

  listExistingUserIds: async (tx, userIds) => {
    if (userIds.length === 0) return []
    const result = await sql<{ readonly id: string }>`
      select u.id from users u where u.id = any(${[...userIds]}::uuid[])
    `.execute(tx)
    return result.rows.map((row) => row.id)
  },

  listFundValueUpdates: async (tx) => {
    const result = await sql<FundValueUpdateRow>`
      select
        f.id as "fundId",
        f.slug as "fundSlug",
        fv.name as "fundName",
        latest.created_at as "lastValueUpdateAt",
        latest.effective_date as "lastValueUpdateEffectiveDate"
      from funds f
      left join fund_versions fv on fv.id = f.current_published_version_id
      left join lateral (
        select e.created_at, to_char(e.effective_date, 'YYYY-MM-DD') as effective_date
        from client_value_entries e
        where e.fund_id = f.id and e.entry_type = 'growth_adjustment'
        order by e.created_at desc, e.id desc
        limit 1
      ) latest on true
      where f.state <> 'draft'
      order by fv.name asc nulls last, f.slug asc
    `.execute(tx)
    return result.rows
  },

  countPendingInvites: async (tx) => {
    const result = await sql<{ readonly count: number; readonly oldestInvitedAt: Date | null }>`
      select count(*)::int as "count", min(u.created_at) as "oldestInvitedAt"
      from users u
      where ${isPendingInvite()}
    `.execute(tx)
    const row = result.rows[0]
    return { count: row?.count ?? 0, oldestInvitedAt: row?.oldestInvitedAt ?? null }
  },
})
