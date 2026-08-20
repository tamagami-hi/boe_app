/**
 * Monthly investor statements, derived from the client value ledger.
 *
 * There is no statements table and no generation job: a statement is a view over
 * the same entries the dashboard reads, cut by calendar month. That keeps a
 * statement from ever disagreeing with the live figures, and means a statement
 * for a past month reflects corrections made later — which is what an
 * admin-managed money model needs.
 *
 * Each period reports what moved and where it left the investor:
 *
 *   opening value  closing value of the previous period (0 for the first)
 *   contributions  accepted contribution value in
 *   growth         admin-posted growth adjustments, net of any loss
 *   reversals      corrections reversing earlier entries (signed)
 *   closing value  opening + contributions + growth + reversals
 *
 * The identity above is the statement's own arithmetic check: it holds because
 * every entry moves value by exactly `value_delta`.
 */
import type { LedgerEntry } from "./portfolioLedger.js"

export interface StatementPeriod {
  /** Calendar month the statement covers, as `YYYY-MM`. */
  readonly period: string
  /** First and last dates of the covered month, `YYYY-MM-DD`. */
  readonly periodStart: string
  readonly periodEnd: string
  readonly openingValuePaise: bigint
  readonly contributionsPaise: bigint
  readonly growthPaise: bigint
  /** Signed: negative when a reversal removes value. */
  readonly reversalsPaise: bigint
  readonly closingValuePaise: bigint
  /** Total principal the investor has put in, as at the end of the period. */
  readonly totalInvestmentPaise: bigint
  readonly entryCount: number
}

const monthOf = (effectiveDate: string): string => effectiveDate.slice(0, 7)

/** Last calendar day of a `YYYY-MM` month, without tripping over month lengths. */
const lastDayOf = (period: string): string => {
  const [year, month] = period.split("-").map((part) => Number(part))
  // Day 0 of the next month is the last day of this one.
  const date = new Date(Date.UTC(year ?? 1970, month ?? 1, 0))
  return date.toISOString().slice(0, 10)
}

/**
 * Group the ledger into month-by-month statements, oldest first. Entries are
 * bucketed by `effectiveDate` — the date the money moved — not by when the row
 * was written, so a back-dated correction lands in the month it belongs to.
 */
export const deriveStatements = (entries: readonly LedgerEntry[]): readonly StatementPeriod[] => {
  const byPeriod = new Map<string, LedgerEntry[]>()
  for (const entry of entries) {
    const period = monthOf(entry.effectiveDate)
    const bucket = byPeriod.get(period)
    if (bucket === undefined) byPeriod.set(period, [entry])
    else bucket.push(entry)
  }

  let openingValue = 0n
  let totalInvestment = 0n
  const periods: StatementPeriod[] = []

  for (const period of [...byPeriod.keys()].sort()) {
    const bucket = byPeriod.get(period) ?? []
    let contributions = 0n
    let growth = 0n
    let reversals = 0n

    for (const entry of bucket) {
      switch (entry.entryType) {
        case "contribution":
          contributions += entry.valueDeltaPaise
          break
        case "growth_adjustment":
          // A loss adjustment is negative; it nets down the period's growth.
          growth += entry.valueDeltaPaise
          break
        case "reversal":
          // A correction is its own signed bucket so reversals stay visible.
          reversals += entry.valueDeltaPaise
          break
      }
      totalInvestment += entry.principalDeltaPaise
    }

    const closingValue = openingValue + contributions + growth + reversals
    periods.push({
      period,
      periodStart: `${period}-01`,
      periodEnd: lastDayOf(period),
      openingValuePaise: openingValue,
      contributionsPaise: contributions,
      growthPaise: growth,
      reversalsPaise: reversals,
      closingValuePaise: closingValue,
      totalInvestmentPaise: totalInvestment,
      entryCount: bucket.length,
    })
    openingValue = closingValue
  }

  return periods
}
