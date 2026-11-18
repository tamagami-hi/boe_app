import { randomUUID } from "node:crypto"

import type { Pool } from "pg"

export type TargetRow = Readonly<{ kind: "sip"; scheduleId: string } | { kind: "one_time"; allocationId: string }>

export interface GrowthSeed {
  readonly userId: string
  readonly fundId: string
  readonly actorUserId: string
  readonly valuePaise: bigint
  readonly effectiveDate?: string
  readonly parts?: readonly Readonly<{ target: TargetRow; amountPaise: bigint }>[]
}

const targetColumns = (target: TargetRow): readonly [string, string | null, string | null] =>
  target.kind === "sip" ? ["sip", target.scheduleId, null] : ["one_time", null, target.allocationId]

export const inTransaction = async <T>(pool: Pool, work: (query: Pool["query"]) => Promise<T>): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query("begin")
    const result = await work(client.query.bind(client))
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export const seedGrowthEntry = (pool: Pool, seed: GrowthSeed): Promise<string> =>
  inTransaction(pool, async (query) => {
    const effectiveDate = seed.effectiveDate ?? "2025-06-01"
    const batch = await query<{ id: string }>(
      "insert into client_growth_batches (scope, instruction_type, effective_date, reason_code, basis_hash, actor_user_id, request_id, target_count, total_delta_paise) " +
        "values ('individual', 'amount', $1, 'test_growth', 'basis', $2, $3, 1, $4) returning id",
      [effectiveDate, seed.actorUserId, `growth-${randomUUID()}`, seed.valuePaise.toString()],
    )
    const entry = await query<{ id: string }>(
      "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
        "growth_batch_id, reason_code, actor_type, created_by_user_id, request_id) " +
        "values ($1, $2, 'growth_adjustment', 0, $3, $4, $5, 'test_growth', 'admin', $6, $7) returning id",
      [seed.userId, seed.fundId, seed.valuePaise.toString(), effectiveDate, batch.rows[0]?.id, seed.actorUserId, `growth-${randomUUID()}`],
    )
    const entryId = entry.rows[0]?.id
    if (entryId === undefined) throw new Error("growth entry not created")
    for (const part of seed.parts ?? []) {
      await query(
        "insert into client_growth_parts (entry_id, user_id, fund_id, target_kind, target_sip_schedule_id, target_allocation_id, amount_paise) " +
          "values ($1, $2, $3, $4, $5, $6, $7)",
        [entryId, seed.userId, seed.fundId, ...targetColumns(part.target), part.amountPaise.toString()],
      )
    }
    return entryId
  })

export const allocationOf = async (pool: Pool, entryId: string): Promise<string> => {
  const row = (await pool.query<{ allocation_id: string }>("select allocation_id from client_value_entries where id = $1", [entryId])).rows[0]
  if (row === undefined) throw new Error("no allocation")
  return row.allocation_id
}

export const insertSplit = (
  pool: Pool,
  seed: Readonly<{
    userId: string
    fundId: string
    actorUserId: string
    cutoffEntryId: string
    totalPaise: bigint
    entryIds: readonly string[]
    parts: readonly Readonly<{ target: TargetRow; amountPaise: bigint }>[]
  }>,
): Promise<string> =>
  inTransaction(pool, async (query) => {
    const split = await query<{ id: string }>(
      "insert into client_earlier_growth_splits (user_id, fund_id, cutoff_entry_id, total_paise, confirmed_by_user_id, request_id) " +
        "values ($1, $2, $3, $4, $5, $6) returning id",
      [seed.userId, seed.fundId, seed.cutoffEntryId, seed.totalPaise.toString(), seed.actorUserId, `split-${randomUUID()}`],
    )
    const splitId = split.rows[0]?.id
    if (splitId === undefined) throw new Error("split not created")
    for (const entryId of seed.entryIds) {
      await query(
        "insert into client_earlier_growth_split_entries (split_id, entry_id, user_id, fund_id) values ($1, $2, $3, $4)",
        [splitId, entryId, seed.userId, seed.fundId],
      )
    }
    for (const part of seed.parts) {
      await query(
        "insert into client_earlier_growth_split_parts (split_id, user_id, fund_id, target_kind, target_sip_schedule_id, target_allocation_id, amount_paise) " +
          "values ($1, $2, $3, $4, $5, $6, $7)",
        [splitId, seed.userId, seed.fundId, ...targetColumns(part.target), part.amountPaise.toString()],
      )
    }
    return splitId
  })
