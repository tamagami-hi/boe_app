/**
 * Bridge between stored ledger rows (money as strings, from PostgreSQL) and the
 * pure derivation engine (money as `bigint`). Kept separate so `portfolioLedger`
 * stays free of persistence concerns and remains trivially unit-testable.
 */
import type { LedgerEntryRow } from "../../repositories/investorLedgerRepository.js"
import type { LedgerEntry } from "./portfolioLedger.js"

export const toLedgerEntry = (row: LedgerEntryRow): LedgerEntry => ({
  id: row.id,
  fundId: row.fundId,
  entryType: row.entryType,
  principalDeltaPaise: BigInt(row.principalDeltaPaise),
  valueDeltaPaise: BigInt(row.valueDeltaPaise),
  amountPaise: BigInt(row.amountPaise),
  effectiveDate: row.effectiveDate,
})

export const toLedgerEntries = (rows: readonly LedgerEntryRow[]): readonly LedgerEntry[] =>
  rows.map(toLedgerEntry)
