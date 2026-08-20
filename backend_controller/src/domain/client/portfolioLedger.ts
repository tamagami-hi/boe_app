/**
 * Portfolio derivation over client value entries (spec §5.7).
 *
 * Every investor figure is derived here from the append-only value ledger,
 * never from a stored balance:
 *
 *   Total Investment = sum of principal deltas (contributions + reversals)
 *   Current Value    = sum of value deltas    (contributions + growth + reversals)
 *   Total Growth     = Current Value - Total Investment
 *   Return %         = Total Growth / Total Investment x 100
 *
 * All money is integer paise carried as `bigint`, so no rounding drift can creep
 * into a balance. The return percentage is the only derived float, computed once
 * for presentation and rounded to two decimals; it is never fed back into money.
 *
 * These functions are pure: the same ledger always derives the same dashboard.
 */
import type { ClientValueEntryType } from "../../db/types.js"

export interface LedgerEntry {
  readonly id: string
  readonly fundId: string
  readonly entryType: ClientValueEntryType
  /** Signed: moves Total Investment. */
  readonly principalDeltaPaise: bigint
  /** Signed: moves Current Portfolio Value. */
  readonly valueDeltaPaise: bigint
  readonly effectiveDate: string
}

export interface PortfolioSummary {
  readonly totalInvestmentPaise: bigint
  readonly currentValuePaise: bigint
  readonly totalGrowthPaise: bigint
  /** Percent to two decimals; null when nothing has been invested yet. */
  readonly returnPercent: number | null
  readonly contributionCount: number
  readonly contributionTotalPaise: bigint
  readonly growthAdjustmentTotalPaise: bigint
  readonly reversalCount: number
  readonly firstContributionDate: string | null
  readonly lastActivityDate: string | null
}

/** Percent scaled by 100, i.e. two decimal places held as an integer. */
const PERCENT_SCALE = 100n

/**
 * Percentage to two decimals, computed in integer arithmetic (half-up rounding,
 * symmetric for losses) and only converted to a float at the boundary. Returns
 * null when there is no invested principal to divide by.
 */
export const returnPercent = (totalGrowthPaise: bigint, totalInvestmentPaise: bigint): number | null => {
  if (totalInvestmentPaise <= 0n) return null
  const numerator = totalGrowthPaise * 100n * PERCENT_SCALE
  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  const rounded = (magnitude + totalInvestmentPaise / 2n) / totalInvestmentPaise
  const signed = negative ? -rounded : rounded
  return Number(signed) / Number(PERCENT_SCALE)
}

/** Fold a ledger into the dashboard figures. Order-independent by construction. */
export const derivePortfolio = (entries: readonly LedgerEntry[]): PortfolioSummary => {
  let totalInvestmentPaise = 0n
  let currentValuePaise = 0n
  let contributionCount = 0
  let contributionTotalPaise = 0n
  let growthAdjustmentTotalPaise = 0n
  let reversalCount = 0
  let firstContributionDate: string | null = null
  let lastActivityDate: string | null = null

  for (const entry of entries) {
    totalInvestmentPaise += entry.principalDeltaPaise
    currentValuePaise += entry.valueDeltaPaise

    switch (entry.entryType) {
      case "contribution":
        contributionCount += 1
        contributionTotalPaise += entry.principalDeltaPaise
        break
      case "growth_adjustment":
        growthAdjustmentTotalPaise += entry.valueDeltaPaise
        break
      case "reversal":
        reversalCount += 1
        break
    }

    if (entry.entryType === "contribution") {
      if (firstContributionDate === null || entry.effectiveDate < firstContributionDate) {
        firstContributionDate = entry.effectiveDate
      }
    }
    if (lastActivityDate === null || entry.effectiveDate > lastActivityDate) {
      lastActivityDate = entry.effectiveDate
    }
  }

  const totalGrowthPaise = currentValuePaise - totalInvestmentPaise

  return {
    totalInvestmentPaise,
    currentValuePaise,
    totalGrowthPaise,
    returnPercent: returnPercent(totalGrowthPaise, totalInvestmentPaise),
    contributionCount,
    contributionTotalPaise,
    growthAdjustmentTotalPaise,
    reversalCount,
    firstContributionDate,
    lastActivityDate,
  }
}
