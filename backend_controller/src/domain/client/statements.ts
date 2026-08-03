/**
 * Monthly investor statements, derived from the ledger (Option B model document
 * sections A, B, E).
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
 *   contributions  SIP installments + lump sums (principal in)
 *   returns        gains allocated by the admin, net of any loss
 *   withdrawals    payouts settled in the period (value out)
 *   closing value  opening + contributions + returns − withdrawals
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
  readonly returnsPaise: bigint
  readonly withdrawalsPaise: bigint
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
    let returns = 0n
    let withdrawals = 0n

    for (const entry of bucket) {
      switch (entry.entryType) {
        case "sip_installment":
        case "lump_sum":
          contributions += entry.valueDeltaPaise
          break
        case "gain_allocation":
          // A loss allocation is a negative gain; it nets down the period's return
          // rather than being reported as a withdrawal.
          returns += entry.valueDeltaPaise
          break
        case "redemption":
          // Payouts are stored as negative value movements; report them positive.
          withdrawals -= entry.valueDeltaPaise
          break
        case "adjustment":
          // A correction is reported with the returns it restates.
          returns += entry.valueDeltaPaise
          break
      }
      totalInvestment += entry.principalDeltaPaise
    }

    const closingValue = openingValue + contributions + returns - withdrawals
    periods.push({
      period,
      periodStart: `${period}-01`,
      periodEnd: lastDayOf(period),
      openingValuePaise: openingValue,
      contributionsPaise: contributions,
      returnsPaise: returns,
      withdrawalsPaise: withdrawals,
      closingValuePaise: closingValue,
      totalInvestmentPaise: totalInvestment,
      entryCount: bucket.length,
    })
    openingValue = closingValue
  }

  return periods
}
