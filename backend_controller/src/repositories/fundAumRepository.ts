import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { FundState, GrowthInstructionType, GrowthScope } from "../db/types.js"
import { LATEST_SNAPSHOT_ORDER, LATEST_SNAPSHOT_PER_FUND_ORDER } from "./fundAumOrdering.js"

export interface FundAumSnapshotRow {
  readonly id: string
  readonly fundId: string
  readonly asOfDate: string
  readonly revision: number
  readonly aumPaise: string
  readonly growthBatchId: string | null
  readonly reasonCode: string
  readonly note: string | null
  readonly publishedByUserId: string
  readonly requestId: string
  readonly createdAt: Date
}

export interface AumGrowthBatchRow {
  readonly id: string
  readonly scope: GrowthScope
  readonly instructionType: GrowthInstructionType
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
  readonly basisHash: string
  readonly actorUserId: string
  readonly requestId: string
  readonly targetCount: number
  readonly totalDeltaPaise: string
  readonly createdAt: Date
}

export interface InsertAumSnapshotInput {
  readonly fundId: string
  readonly asOfDate: string
  readonly revision: number
  readonly aumPaise: string
  readonly growthBatchId: string | null
  readonly reasonCode: string
  readonly note: string | null
  readonly publishedByUserId: string
  readonly requestId: string
}

export interface InsertAumGrowthBatchInput {
  readonly scope: GrowthScope
  readonly instructionType: GrowthInstructionType
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
  readonly basisHash: string
  readonly actorUserId: string
  readonly requestId: string
  readonly targetCount: number
  readonly totalDeltaPaise: string
}

export interface FundAumLockRow {
  readonly id: string
  readonly state: FundState
}

export interface SnapshotPageQuery {
  readonly limit: number
  readonly afterAsOfDate?: string
  readonly afterRevision?: number
  readonly afterCreatedAt?: string
  readonly afterId?: string
}

export interface FundAumRepository {
  lockFund: (tx: Transaction, fundId: string) => Promise<FundAumLockRow | null>
  lockFunds: (tx: Transaction, fundIds: readonly string[]) => Promise<readonly FundAumLockRow[]>
  findExistingFundIds: (tx: Transaction, fundIds: readonly string[]) => Promise<readonly string[]>
  findLatestSnapshot: (tx: Transaction, fundId: string) => Promise<FundAumSnapshotRow | null>
  findLatestSnapshots: (tx: Transaction, fundIds: readonly string[]) => Promise<readonly FundAumSnapshotRow[]>
  findSnapshotById: (tx: Transaction, snapshotId: string) => Promise<FundAumSnapshotRow | null>
  findHighestRevision: (tx: Transaction, fundId: string, asOfDate: string) => Promise<number | null>
  insertSnapshot: (tx: Transaction, input: InsertAumSnapshotInput) => Promise<FundAumSnapshotRow>
  insertBatch: (tx: Transaction, input: InsertAumGrowthBatchInput) => Promise<AumGrowthBatchRow>
  listSnapshots: (
    tx: Transaction,
    fundId: string,
    query: SnapshotPageQuery,
  ) => Promise<readonly FundAumSnapshotRow[]>
}

const SNAPSHOT_COLUMNS = sql`
  id as "id",
  fund_id as "fundId",
  as_of_date::text as "asOfDate",
  revision as "revision",
  aum_paise::text as "aumPaise",
  aum_growth_batch_id as "growthBatchId",
  reason_code as "reasonCode",
  note as "note",
  published_by_user_id as "publishedByUserId",
  request_id as "requestId",
  created_at as "createdAt"
`

const firstRow = <Row>(rows: readonly Row[]): Row => {
  const row = rows[0]
  if (row === undefined) throw new Error("statement returned no row")
  return row
}

export const createFundAumRepository = (): FundAumRepository => ({
  lockFund: async (tx, fundId) => {
    const result = await sql<FundAumLockRow>`
      select id, state from funds where id = ${fundId} for update
    `.execute(tx)
    return result.rows[0] ?? null
  },

  lockFunds: async (tx, fundIds) => {
    const result = await sql<FundAumLockRow>`
      select id, state from funds where id = any(${[...fundIds]}) order by id asc for update
    `.execute(tx)
    return result.rows
  },

  findExistingFundIds: async (tx, fundIds) => {
    const result = await sql<{ id: string }>`
      select id from funds where id = any(${[...fundIds]}) order by id asc
    `.execute(tx)
    return result.rows.map((row) => row.id)
  },

  findLatestSnapshot: async (tx, fundId) => {
    const result = await sql<FundAumSnapshotRow>`
      select ${SNAPSHOT_COLUMNS} from fund_aum_snapshots
      where fund_id = ${fundId}
      order by ${LATEST_SNAPSHOT_ORDER}
      limit 1
    `.execute(tx)
    return result.rows[0] ?? null
  },

  findLatestSnapshots: async (tx, fundIds) => {
    const result = await sql<FundAumSnapshotRow>`
      select distinct on (fund_id) ${SNAPSHOT_COLUMNS} from fund_aum_snapshots
      where fund_id = any(${[...fundIds]})
      order by ${LATEST_SNAPSHOT_PER_FUND_ORDER}
    `.execute(tx)
    return result.rows
  },

  findSnapshotById: async (tx, snapshotId) => {
    const result = await sql<FundAumSnapshotRow>`
      select ${SNAPSHOT_COLUMNS} from fund_aum_snapshots where id = ${snapshotId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  findHighestRevision: async (tx, fundId, asOfDate) => {
    const result = await sql<{ revision: number }>`
      select max(revision)::int as "revision" from fund_aum_snapshots
      where fund_id = ${fundId} and as_of_date = ${asOfDate}::date
    `.execute(tx)
    return result.rows[0]?.revision ?? null
  },

  insertSnapshot: async (tx, input) => {
    const result = await sql<FundAumSnapshotRow>`
      insert into fund_aum_snapshots
        (fund_id, as_of_date, revision, aum_paise, aum_growth_batch_id,
         reason_code, note, published_by_user_id, request_id)
      values
        (${input.fundId}, ${input.asOfDate}::date, ${input.revision}, ${input.aumPaise}::bigint,
         ${input.growthBatchId}, ${input.reasonCode}, ${input.note},
         ${input.publishedByUserId}, ${input.requestId})
      returning ${SNAPSHOT_COLUMNS}
    `.execute(tx)
    return firstRow(result.rows)
  },

  insertBatch: async (tx, input) => {
    const result = await sql<AumGrowthBatchRow>`
      insert into aum_growth_batches
        (scope, instruction_type, effective_date, reason_code, note, basis_hash,
         actor_user_id, request_id, target_count, total_delta_paise)
      values
        (${input.scope}, ${input.instructionType}, ${input.effectiveDate}::date,
         ${input.reasonCode}, ${input.note}, ${input.basisHash},
         ${input.actorUserId}, ${input.requestId}, ${input.targetCount},
         ${input.totalDeltaPaise}::bigint)
      returning
        id as "id",
        scope as "scope",
        instruction_type as "instructionType",
        effective_date::text as "effectiveDate",
        reason_code as "reasonCode",
        note as "note",
        basis_hash as "basisHash",
        actor_user_id as "actorUserId",
        request_id as "requestId",
        target_count as "targetCount",
        total_delta_paise::text as "totalDeltaPaise",
        created_at as "createdAt"
    `.execute(tx)
    return firstRow(result.rows)
  },

  listSnapshots: async (tx, fundId, query) => {
    const keyset =
      query.afterAsOfDate !== undefined
      && query.afterRevision !== undefined
      && query.afterCreatedAt !== undefined
      && query.afterId !== undefined
        ? sql`and (as_of_date, revision, created_at, id)
              < (${query.afterAsOfDate}::date, ${query.afterRevision},
                 ${query.afterCreatedAt}::timestamptz, ${query.afterId}::uuid)`
        : sql``
    const result = await sql<FundAumSnapshotRow>`
      select ${SNAPSHOT_COLUMNS} from fund_aum_snapshots
      where fund_id = ${fundId} ${keyset}
      order by ${LATEST_SNAPSHOT_ORDER}
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },
})
