/**
 * Client growth write repository (spec §5.7/§5.9, §8).
 *
 * Reads position bases from the append-only client value ledger and writes
 * `growth_adjustment` entries grouped under `client_growth_batches` headers.
 * A position's basis is the summed `value_delta_paise` of its visible entries
 * (reversal rows and rows they reverse are both excluded — a reversed pair
 * nets to zero), restricted to positions with at least one unreversed
 * contribution ("accepted").
 *
 * Locking discipline (§8.5): callers take one transaction advisory lock per
 * `(user_id, fund_id)` in sorted order before reloading bases, so concurrent
 * loss adjustments cannot drive a value negative.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { GrowthInstructionType, GrowthScope } from "../db/types.js"

export interface ClientPositionBasisRow {
  readonly userId: string
  /** bigint as text; convert with `BigInt(...)` before arithmetic. */
  readonly currentValuePaise: string
  readonly latestEntryId: string | null
}

export interface InsertClientGrowthBatchInput {
  readonly scope: GrowthScope
  readonly instructionType: GrowthInstructionType
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
  readonly basisHash: string
  readonly actorUserId: string
  readonly requestId: string
  readonly targetCount: number
  readonly totalDeltaPaise: bigint
}

export interface InsertGrowthEntryInput {
  readonly batchId: string
  readonly userId: string
  readonly fundId: string
  readonly valueDeltaPaise: bigint
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface ClientGrowthRepository {
  /** Blocking transaction-scoped advisory lock for one position. */
  lockPosition: (tx: Transaction, userId: string, fundId: string) => Promise<void>
  /** The position basis, or null when no unreversed contribution exists. */
  findPositionBasis: (
    tx: Transaction,
    userId: string,
    fundId: string,
  ) => Promise<ClientPositionBasisRow | null>
  /** Every contribution-bearing position in one fund, sorted by user_id. */
  listFundPositionBases: (
    tx: Transaction,
    fundId: string,
  ) => Promise<readonly ClientPositionBasisRow[]>
  insertBatch: (
    tx: Transaction,
    input: InsertClientGrowthBatchInput,
  ) => Promise<{ readonly id: string }>
  insertGrowthEntry: (
    tx: Transaction,
    input: InsertGrowthEntryInput,
  ) => Promise<{ readonly id: string }>
  /** Back-fill the batch's idempotency record once it exists (same transaction). */
  linkBatchIdempotencyRecord: (
    tx: Transaction,
    batchId: string,
    idempotencyRecordId: string,
  ) => Promise<void>
}

const positionBasisQuery = (fundId: string, userId: string | null) => sql<ClientPositionBasisRow>`
  with visible as (
    select e.id, e.user_id, e.value_delta_paise, e.entry_type, e.created_at
    from client_value_entries e
    where e.fund_id = ${fundId}
      ${userId === null ? sql`` : sql`and e.user_id = ${userId}`}
      and e.entry_type <> 'reversal'
      and not exists (
        select 1 from client_value_entries r where r.reverses_entry_id = e.id
      )
  )
  select
    v.user_id as "userId",
    sum(v.value_delta_paise)::text as "currentValuePaise",
    (array_agg(v.id order by v.created_at desc, v.id desc))[1] as "latestEntryId"
  from visible v
  group by v.user_id
  having bool_or(v.entry_type = 'contribution')
  order by v.user_id asc
`

export const createClientGrowthRepository = (): ClientGrowthRepository => ({
  lockPosition: async (tx, userId, fundId) => {
    // Two-int form namespaces the lock away from the idempotency subsystem's
    // sha256-derived bigint keys.
    await sql`
      select pg_advisory_xact_lock(hashtext('client-growth-position'), hashtext(${userId} || ':' || ${fundId}))
    `.execute(tx)
  },

  findPositionBasis: async (tx, userId, fundId) => {
    const result = await positionBasisQuery(fundId, userId).execute(tx)
    return result.rows[0] ?? null
  },

  listFundPositionBases: async (tx, fundId) => {
    const result = await positionBasisQuery(fundId, null).execute(tx)
    return result.rows
  },

  insertBatch: async (tx, input) =>
    tx
      .insertInto("client_growth_batches")
      .values({
        scope: input.scope,
        instruction_type: input.instructionType,
        effective_date: input.effectiveDate,
        reason_code: input.reasonCode,
        note: input.note,
        basis_hash: input.basisHash,
        actor_user_id: input.actorUserId,
        request_id: input.requestId,
        // Set by linkBatchIdempotencyRecord once the scoped record exists.
        idempotency_record_id: null,
        target_count: input.targetCount,
        total_delta_paise: input.totalDeltaPaise,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  insertGrowthEntry: async (tx, input) =>
    tx
      .insertInto("client_value_entries")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        allocation_id: null,
        entry_type: "growth_adjustment",
        principal_delta_paise: 0n,
        value_delta_paise: input.valueDeltaPaise,
        effective_date: input.effectiveDate,
        order_id: null,
        payment_id: null,
        growth_batch_id: input.batchId,
        reason_code: input.reasonCode,
        note: input.note,
        reverses_entry_id: null,
        actor_type: "admin",
        created_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  linkBatchIdempotencyRecord: async (tx, batchId, idempotencyRecordId) => {
    const result = await tx
      .updateTable("client_growth_batches")
      .set({ idempotency_record_id: idempotencyRecordId })
      .where("id", "=", batchId)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error(`client growth batch ${batchId} missing at idempotency link time`)
    }
  },
})
