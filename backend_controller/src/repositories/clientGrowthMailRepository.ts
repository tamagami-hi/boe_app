import { sql } from "kysely"

import type { Transaction, User } from "../db/repositories.js"

export type GrowthMailRecipient = Pick<
  User,
  "id" | "email_normalized" | "full_name" | "email_revision" | "account_state" | "pii_tombstoned_at"
>

export interface GrowthEntryState {
  readonly reversed: boolean
}

export interface GrowthEntryReference {
  readonly batchId: string
  readonly userId: string
  readonly fundId: string
}

export interface ClientGrowthMailRepository {
  listRecipients: (tx: Transaction, userIds: readonly string[]) => Promise<readonly GrowthMailRecipient[]>
  findFundName: (tx: Transaction, fundId: string) => Promise<string | null>
  listValues: (tx: Transaction, fundId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, bigint>>
  findGrowthEntry: (tx: Transaction, reference: GrowthEntryReference) => Promise<GrowthEntryState | null>
}

export const createClientGrowthMailRepository = (): ClientGrowthMailRepository => ({
  listRecipients: async (tx, userIds) =>
    userIds.length === 0
      ? []
      : await tx
          .selectFrom("users")
          .select(["id", "email_normalized", "full_name", "email_revision", "account_state", "pii_tombstoned_at"])
          .where("id", "in", [...userIds])
          .orderBy("id", "asc")
          .execute(),

  findFundName: async (tx, fundId) =>
    (
      await sql<{ readonly name: string }>`
        select coalesce(fv.name, f.slug) as name
        from funds f
        left join fund_versions fv on fv.id = f.current_published_version_id
        where f.id = ${fundId}
      `.execute(tx)
    ).rows[0]?.name ?? null,

  listValues: async (tx, fundId, userIds) => {
    if (userIds.length === 0) return new Map()
    const rows = (
      await sql<{ readonly userId: string; readonly valuePaise: string }>`
        select e.user_id as "userId", sum(e.value_delta_paise)::text as "valuePaise"
        from client_value_entries e
        where e.fund_id = ${fundId} and e.user_id = any(${[...userIds]}::uuid[])
        group by e.user_id
      `.execute(tx)
    ).rows
    return new Map(rows.map((row) => [row.userId, BigInt(row.valuePaise)]))
  },

  findGrowthEntry: async (tx, reference) =>
    (
      await sql<GrowthEntryState>`
        select exists (select 1 from client_value_entries r where r.reverses_entry_id = e.id) as reversed
        from client_value_entries e
        where e.growth_batch_id = ${reference.batchId}
          and e.user_id = ${reference.userId}
          and e.fund_id = ${reference.fundId}
          and e.entry_type = 'growth_adjustment'
      `.execute(tx)
    ).rows[0] ?? null,
})
