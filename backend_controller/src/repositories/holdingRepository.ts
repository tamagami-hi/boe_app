/**
 * Holding/booking write repository (spec 03 §4.3, §6 "Payment success/book").
 * Owns the append-only booked-evidence writes and the authoritative ownership
 * projection: the allotment execution, the holding balance (created or
 * incremented), the acquisition lot, and the lot movement. Ownership is carried
 * by composite `(…, user_id, fund_id)` foreign keys so a booking can never touch
 * another user's rows. Executions, lots, and movements are append-only.
 */
import { sql } from "kysely"

import type {
  Holding,
  HoldingLot,
  HoldingLotMovement,
  InvestmentExecution,
  Transaction,
} from "../db/repositories.js"

export interface CurrentNavRow {
  readonly id: string
  readonly nav: string
  readonly asOfDate: string
}

export interface InsertExecutionInput {
  readonly orderId: string
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly nav: string
  readonly units: string
  readonly now: Date
}

export interface UpsertHoldingInput {
  readonly userId: string
  readonly fundId: string
  readonly addUnits: string
  readonly addCostBasisPaise: string
}

export interface InsertLotInput {
  readonly holdingId: string
  readonly userId: string
  readonly fundId: string
  readonly sourceExecutionId: string
  readonly acquiredOn: string
  readonly costBasisPaise: string
  readonly units: string
}

export interface InsertMovementInput {
  readonly holdingLotId: string
  readonly holdingId: string
  readonly userId: string
  readonly fundId: string
  readonly executionId: string
  readonly unitsDelta: string
  readonly costBasisDeltaPaise: string
  readonly now: Date
}

export interface HoldingWriteRepository {
  /** The applicable current NAV: greatest as_of_date then greatest revision. */
  findCurrentNav: (tx: Transaction, fundId: string) => Promise<CurrentNavRow | null>
  insertAllotmentExecution: (tx: Transaction, input: InsertExecutionInput) => Promise<InvestmentExecution>
  /** Create or increment the (user, fund) holding; returns the updated row. */
  upsertHolding: (tx: Transaction, input: UpsertHoldingInput) => Promise<Holding>
  insertLot: (tx: Transaction, input: InsertLotInput) => Promise<HoldingLot>
  insertAllotmentMovement: (tx: Transaction, input: InsertMovementInput) => Promise<HoldingLotMovement>
}

export const createHoldingRepository = (): HoldingWriteRepository => ({
  findCurrentNav: async (tx, fundId) => {
    const result = await sql<CurrentNavRow>`
      select id as "id", nav::text as "nav", as_of_date::text as "asOfDate"
      from fund_nav_prices
      where fund_id = ${fundId}
      order by as_of_date desc, revision desc
      limit 1
    `.execute(tx)
    return result.rows[0] ?? null
  },

  insertAllotmentExecution: async (tx, input) =>
    tx
      .insertInto("investment_executions")
      .values({
        order_id: input.orderId,
        user_id: input.userId,
        fund_id: input.fundId,
        type: "allotment",
        amount_paise: input.amountPaise,
        nav: input.nav,
        units: input.units,
        executed_at: input.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  upsertHolding: async (tx, input) => {
    const result = await sql<Holding>`
      insert into holdings (user_id, fund_id, total_units, reserved_units, cost_basis_paise)
      values (${input.userId}, ${input.fundId}, ${input.addUnits}, 0, ${input.addCostBasisPaise})
      on conflict (user_id, fund_id) do update set
        total_units = holdings.total_units + excluded.total_units,
        cost_basis_paise = holdings.cost_basis_paise + excluded.cost_basis_paise,
        version = holdings.version + 1,
        updated_at = now()
      returning *
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("holding upsert returned no row")
    return row
  },

  insertLot: async (tx, input) =>
    tx
      .insertInto("holding_lots")
      .values({
        holding_id: input.holdingId,
        user_id: input.userId,
        fund_id: input.fundId,
        source_execution_id: input.sourceExecutionId,
        acquired_on: input.acquiredOn,
        cost_basis_paise: input.costBasisPaise,
        original_units: input.units,
        remaining_units: input.units,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  insertAllotmentMovement: async (tx, input) =>
    tx
      .insertInto("holding_lot_movements")
      .values({
        holding_lot_id: input.holdingLotId,
        holding_id: input.holdingId,
        user_id: input.userId,
        fund_id: input.fundId,
        execution_id: input.executionId,
        movement_type: "allotment",
        units_delta: input.unitsDelta,
        cost_basis_delta_paise: input.costBasisDeltaPaise,
        occurred_at: input.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
})
