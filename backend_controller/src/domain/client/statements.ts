import type { LedgerEntry } from "./portfolioLedger.js"

const assertNever = (value: never): never => {
  throw new Error(`unhandled client value entry type: ${String(value)}`)
}

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
    let growth = 0n
    let reversals = 0n
    let withdrawals = 0n

    for (const entry of bucket) {
      switch (entry.entryType) {
        case "contribution":
          contributions += entry.valueDeltaPaise
          break
        case "growth_adjustment":
          growth += entry.valueDeltaPaise
          break
        case "reversal":
          reversals += entry.valueDeltaPaise
          break
        case "withdrawal":
          withdrawals += entry.valueDeltaPaise
          break
        case "maturity_reinvestment":
          break
        default:
          assertNever(entry.entryType)
      }
      totalInvestment += entry.principalDeltaPaise
    }

    const closingValue = openingValue + contributions + growth + reversals + withdrawals
    periods.push({
      period,
      periodStart: `${period}-01`,
      periodEnd: lastDayOf(period),
      openingValuePaise: openingValue,
      contributionsPaise: contributions,
      growthPaise: growth,
      reversalsPaise: reversals,
      withdrawalsPaise: withdrawals,
      closingValuePaise: closingValue,
      totalInvestmentPaise: totalInvestment,
      entryCount: bucket.length,
    })
    openingValue = closingValue
  }

  return periods
}
