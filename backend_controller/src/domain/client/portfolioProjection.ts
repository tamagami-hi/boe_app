/**
 * Bridge between stored client value-entry rows (money as strings, from
 * PostgreSQL) and the pure derivation engine (money as `bigint`). Kept separate
 * so `portfolioLedger` stays free of persistence concerns and remains trivially
 * unit-testable.
 */
import type { ClientValueEntryRow } from "../../repositories/clientValueEntryRepository.js"
import type { LedgerEntry } from "./portfolioLedger.js"

export const toLedgerEntry = (row: ClientValueEntryRow): LedgerEntry => ({
  id: row.id,
  fundId: row.fundId,
  entryType: row.entryType,
  principalDeltaPaise: BigInt(row.principalDeltaPaise),
  valueDeltaPaise: BigInt(row.valueDeltaPaise),
  effectiveDate: row.effectiveDate,
})

export const toLedgerEntries = (rows: readonly ClientValueEntryRow[]): readonly LedgerEntry[] =>
  rows.map(toLedgerEntry)
