import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { MaturitySettlement, MaturityState, WithdrawalState } from "../db/types.js"

export interface MaturityRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly state: MaturityState
  readonly maturedOn: string
  readonly principalAtMaturityPaise: bigint
  readonly valueAtMaturityPaise: bigint
  readonly settlement: MaturitySettlement | null
  readonly settlementEntryId: string | null
  readonly reasonCode: string
  readonly version: string
}

export interface MarkMaturityInput {
  readonly userId: string
  readonly fundId: string
  readonly maturedOn: string
  readonly principalAtMaturityPaise: bigint
  readonly valueAtMaturityPaise: bigint
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface SettleMaturityInput {
  readonly maturityId: string
  readonly settlement: MaturitySettlement
  readonly settlementEntryId: string
  readonly now: Date
}

export interface RecordWithdrawalPayoutInput {
  readonly userId: string
  readonly fundId: string
  readonly maturityId: string
  readonly ledgerEntryId: string
  readonly amountPaise: bigint
  readonly growthPortionPaise: bigint
  readonly principalPortionPaise: bigint
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface WithdrawalPayoutRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly maturityId: string
  readonly ledgerEntryId: string
  readonly version: string
  readonly failureCode: string | null
  readonly state: WithdrawalState
  readonly amountPaise: bigint
  readonly growthPortionPaise: bigint
  readonly principalPortionPaise: bigint
  readonly effectiveDate: string
  readonly transferReference: string | null
  readonly createdAt: Date
}

export interface SettlementEntryInput {
  readonly userId: string
  readonly fundId: string
  readonly entryType: "withdrawal" | "maturity_reinvestment"
  readonly principalDeltaPaise: bigint
  readonly valueDeltaPaise: bigint
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface MaturityRepository {
  insertSettlementEntry: (tx: Transaction, input: SettlementEntryInput) => Promise<{ readonly id: string }>
  getPositionEffectiveDate: (tx: Transaction, userId: string, fundId: string) => Promise<string | null>
  markMatured: (tx: Transaction, input: MarkMaturityInput) => Promise<{ readonly id: string }>
  lockOpenMaturity: (
    tx: Transaction,
    input: Readonly<{ userId: string; fundId: string }>,
  ) => Promise<MaturityRow | null>
  lockMaturityById: (
    tx: Transaction,
    input: Readonly<{ userId: string; maturityId: string }>,
  ) => Promise<MaturityRow | null>
  listMaturities: (
    tx: Transaction,
    input: Readonly<{ userId: string; limit: number }>,
  ) => Promise<readonly MaturityRow[]>
  settleMaturity: (tx: Transaction, input: SettleMaturityInput) => Promise<void>
  insertWithdrawalPayout: (
    tx: Transaction,
    input: RecordWithdrawalPayoutInput,
  ) => Promise<{ readonly id: string }>
  listWithdrawalPayouts: (
    tx: Transaction,
    input: Readonly<{ userId: string; limit: number }>,
  ) => Promise<readonly WithdrawalPayoutRow[]>
  markPayoutPaid: (
    tx: Transaction,
    input: Readonly<{
      userId: string
      payoutId: string
      transferReference: string
      expectedVersion: number
      now: Date
    }>,
  ) => Promise<boolean>
  markPayoutFailed: (
    tx: Transaction,
    input: Readonly<{
      userId: string
      payoutId: string
      failureCode: string
      expectedVersion: number
      now: Date
    }>,
  ) => Promise<boolean>
}

interface MaturitySqlRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly state: MaturityState
  readonly maturedOn: string
  readonly principalAtMaturityPaise: string
  readonly valueAtMaturityPaise: string
  readonly settlement: MaturitySettlement | null
  readonly settlementEntryId: string | null
  readonly reasonCode: string
  readonly version: string
}

const mapMaturity = (row: MaturitySqlRow): MaturityRow => ({
  id: row.id,
  userId: row.userId,
  fundId: row.fundId,
  state: row.state,
  maturedOn: row.maturedOn,
  principalAtMaturityPaise: BigInt(row.principalAtMaturityPaise),
  valueAtMaturityPaise: BigInt(row.valueAtMaturityPaise),
  settlement: row.settlement,
  settlementEntryId: row.settlementEntryId,
  reasonCode: row.reasonCode,
  version: row.version,
})

const maturitySelection = sql`
  select
    m.id as "id",
    m.user_id as "userId",
    m.fund_id as "fundId",
    m.state as "state",
    to_char(m.matured_on, 'YYYY-MM-DD') as "maturedOn",
    m.principal_at_maturity_paise::text as "principalAtMaturityPaise",
    m.value_at_maturity_paise::text as "valueAtMaturityPaise",
    m.settlement as "settlement",
    m.settlement_entry_id as "settlementEntryId",
    m.reason_code as "reasonCode",
    m.version::text as "version"
  from client_position_maturities m
`

interface PayoutSqlRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly maturityId: string
  readonly ledgerEntryId: string
  readonly version: string
  readonly failureCode: string | null
  readonly state: WithdrawalState
  readonly amountPaise: string
  readonly growthPortionPaise: string
  readonly principalPortionPaise: string
  readonly effectiveDate: string
  readonly transferReference: string | null
  readonly createdAt: Date
}

export const createMaturityRepository = (): MaturityRepository => ({
  insertSettlementEntry: async (tx, input) =>
    tx.insertInto("client_value_entries").values({
      user_id: input.userId,
      fund_id: input.fundId,
      allocation_id: null,
      entry_type: input.entryType,
      principal_delta_paise: input.principalDeltaPaise,
      value_delta_paise: input.valueDeltaPaise,
      effective_date: input.effectiveDate,
      order_id: null,
      payment_id: null,
      growth_batch_id: null,
      reason_code: input.reasonCode,
      note: input.note,
      reverses_entry_id: null,
      actor_type: "admin",
      created_by_user_id: input.actorUserId,
      request_id: input.requestId,
    }).returning("id").executeTakeFirstOrThrow(),

  getPositionEffectiveDate: async (tx, userId, fundId) => {
    const result = await sql<{ readonly effectiveDate: string | null }>`
      select to_char(max(effective_date), 'YYYY-MM-DD') as "effectiveDate"
      from client_value_entries where user_id = ${userId} and fund_id = ${fundId}
    `.execute(tx)
    return result.rows[0]?.effectiveDate ?? null
  },
  markMatured: async (tx, input) =>
    tx
      .insertInto("client_position_maturities")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        state: "pending",
        matured_on: input.maturedOn,
        principal_at_maturity_paise: input.principalAtMaturityPaise,
        value_at_maturity_paise: input.valueAtMaturityPaise,
        reason_code: input.reasonCode,
        note: input.note,
        marked_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  lockOpenMaturity: async (tx, input) => {
    const result = await sql<MaturitySqlRow>`
      ${maturitySelection}
      where m.user_id = ${input.userId} and m.fund_id = ${input.fundId} and m.state = 'pending'
      for update
    `.execute(tx)
    const row = result.rows[0]
    return row === undefined ? null : mapMaturity(row)
  },

  lockMaturityById: async (tx, input) => {
    const result = await sql<MaturitySqlRow>`
      ${maturitySelection}
      where m.id = ${input.maturityId} and m.user_id = ${input.userId}
      for update
    `.execute(tx)
    const row = result.rows[0]
    return row === undefined ? null : mapMaturity(row)
  },

  listMaturities: async (tx, input) => {
    const result = await sql<MaturitySqlRow>`
      ${maturitySelection}
      where m.user_id = ${input.userId}
      order by m.matured_on desc, m.created_at desc, m.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows.map(mapMaturity)
  },

  settleMaturity: async (tx, input) => {
    const result = await tx
      .updateTable("client_position_maturities")
      .set({
        state: "settled",
        settlement: input.settlement,
        settlement_entry_id: input.settlementEntryId,
        settled_at: input.now,
        updated_at: input.now,
        version: sql<string>`client_position_maturities.version + 1`,
      })
      .where("id", "=", input.maturityId)
      .where("state", "=", "pending")
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error(`maturity ${input.maturityId} was not open at settlement time`)
    }
  },

  insertWithdrawalPayout: async (tx, input) =>
    tx
      .insertInto("withdrawal_operations")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        maturity_id: input.maturityId,
        ledger_entry_id: input.ledgerEntryId,
        state: "pending",
        amount_paise: input.amountPaise,
        growth_portion_paise: input.growthPortionPaise,
        principal_portion_paise: input.principalPortionPaise,
        effective_date: input.effectiveDate,
        reason_code: input.reasonCode,
        note: input.note,
        created_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  listWithdrawalPayouts: async (tx, input) => {
    const result = await sql<PayoutSqlRow>`
      select
        w.id as "id",
        w.user_id as "userId",
        w.fund_id as "fundId",
        w.maturity_id as "maturityId",
        w.ledger_entry_id as "ledgerEntryId",
        w.version::text as "version",
        w.failure_code as "failureCode",
        w.state::text as "state",
        w.amount_paise::text as "amountPaise",
        w.growth_portion_paise::text as "growthPortionPaise",
        w.principal_portion_paise::text as "principalPortionPaise",
        to_char(w.effective_date, 'YYYY-MM-DD') as "effectiveDate",
        w.transfer_reference as "transferReference",
        w.created_at as "createdAt"
      from withdrawal_operations w
      where w.user_id = ${input.userId}
      order by w.created_at desc, w.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      fundId: row.fundId,
      maturityId: row.maturityId,
      ledgerEntryId: row.ledgerEntryId,
      version: row.version,
      failureCode: row.failureCode,
      state: row.state,
      amountPaise: BigInt(row.amountPaise),
      growthPortionPaise: BigInt(row.growthPortionPaise),
      principalPortionPaise: BigInt(row.principalPortionPaise),
      effectiveDate: row.effectiveDate,
      transferReference: row.transferReference,
      createdAt: row.createdAt,
    }))
  },

  markPayoutPaid: async (tx, input) => {
    const result = await tx
      .updateTable("withdrawal_operations")
      .set({
        state: "paid",
        paid_at: input.now,
        transfer_reference: input.transferReference,
        updated_at: input.now,
        version: sql<string>`withdrawal_operations.version + 1`,
      })
      .where("id", "=", input.payoutId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "pending")
      .where(sql<boolean>`version = ${input.expectedVersion}`)
      .executeTakeFirst()
    return Number(result.numUpdatedRows) === 1
  },

  markPayoutFailed: async (tx, input) => {
    const result = await tx
      .updateTable("withdrawal_operations")
      .set({
        state: "failed",
        failed_at: input.now,
        failure_code: input.failureCode,
        updated_at: input.now,
        version: sql<string>`withdrawal_operations.version + 1`,
      })
      .where("id", "=", input.payoutId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "pending")
      .where(sql<boolean>`version = ${input.expectedVersion}`)
      .executeTakeFirst()
    return Number(result.numUpdatedRows) === 1
  },
})
