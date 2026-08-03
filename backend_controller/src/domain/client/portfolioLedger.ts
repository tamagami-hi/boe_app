/**
 * Option B portfolio derivation (no units, no NAV).
 *
 * Every investor figure is derived here from the append-only ledger, never from a
 * stored balance:
 *
 *   Total Investment = SIP paid + lump sums - principal redeemed   (sum of principal deltas)
 *   Current Value    = previous value + allocated gain - redemption + new investment
 *                                                                  (sum of value deltas)
 *   Total Return     = Current Value - Total Investment
 *   Return %         = Total Return / Total Investment x 100
 *
 * All money is integer paise carried as `bigint`, so no rounding drift can creep
 * into a balance. The return percentage is the only derived float, computed once
 * for presentation and rounded to two decimals; it is never fed back into money.
 *
 * These functions are pure: the same ledger always derives the same dashboard.
 */
import type { LedgerEntryType, RedemptionMode } from "../../db/types.js"

export interface LedgerEntry {
  readonly id: string
  readonly fundId: string
  readonly entryType: LedgerEntryType
  /** Signed: moves Total Investment. */
  readonly principalDeltaPaise: bigint
  /** Signed: moves Current Portfolio Value. */
  readonly valueDeltaPaise: bigint
  /** Always positive: the investor-facing size of the event. */
  readonly amountPaise: bigint
  readonly effectiveDate: string
}

export interface PortfolioSummary {
  readonly totalInvestmentPaise: bigint
  readonly currentValuePaise: bigint
  readonly totalReturnPaise: bigint
  /** Percent to two decimals; null when nothing has been invested yet. */
  readonly returnPercent: number | null
  readonly sipInstallmentCount: number
  readonly sipTotalPaise: bigint
  readonly lumpSumCount: number
  readonly lumpSumTotalPaise: bigint
  readonly redemptionCount: number
  readonly redeemedTotalPaise: bigint
  readonly allocatedGainPaise: bigint
  readonly firstInvestmentDate: string | null
  readonly lastActivityDate: string | null
}

/** Percent scaled by 100, i.e. two decimal places held as an integer. */
const PERCENT_SCALE = 100n

/**
 * Percentage to two decimals, computed in integer arithmetic (half-up rounding,
 * symmetric for losses) and only converted to a float at the boundary. Returns
 * null when there is no invested principal to divide by — an investor holding
 * only allocated gain has no meaningful return percentage.
 */
export const returnPercent = (totalReturnPaise: bigint, totalInvestmentPaise: bigint): number | null => {
  if (totalInvestmentPaise <= 0n) return null
  const numerator = totalReturnPaise * 100n * PERCENT_SCALE
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
  let sipInstallmentCount = 0
  let sipTotalPaise = 0n
  let lumpSumCount = 0
  let lumpSumTotalPaise = 0n
  let redemptionCount = 0
  let redeemedTotalPaise = 0n
  let allocatedGainPaise = 0n
  let firstInvestmentDate: string | null = null
  let lastActivityDate: string | null = null

  for (const entry of entries) {
    totalInvestmentPaise += entry.principalDeltaPaise
    currentValuePaise += entry.valueDeltaPaise

    switch (entry.entryType) {
      case "sip_installment":
        sipInstallmentCount += 1
        sipTotalPaise += entry.amountPaise
        break
      case "lump_sum":
        lumpSumCount += 1
        lumpSumTotalPaise += entry.amountPaise
        break
      case "redemption":
        redemptionCount += 1
        redeemedTotalPaise += entry.amountPaise
        break
      case "gain_allocation":
        allocatedGainPaise += entry.valueDeltaPaise
        break
      case "adjustment":
        break
    }

    const isContribution = entry.entryType === "sip_installment" || entry.entryType === "lump_sum"
    if (isContribution && (firstInvestmentDate === null || entry.effectiveDate < firstInvestmentDate)) {
      firstInvestmentDate = entry.effectiveDate
    }
    if (lastActivityDate === null || entry.effectiveDate > lastActivityDate) {
      lastActivityDate = entry.effectiveDate
    }
  }

  const totalReturnPaise = currentValuePaise - totalInvestmentPaise

  return {
    totalInvestmentPaise,
    currentValuePaise,
    totalReturnPaise,
    returnPercent: returnPercent(totalReturnPaise, totalInvestmentPaise),
    sipInstallmentCount,
    sipTotalPaise,
    lumpSumCount,
    lumpSumTotalPaise,
    redemptionCount,
    redeemedTotalPaise,
    allocatedGainPaise,
    firstInvestmentDate,
    lastActivityDate,
  }
}

export interface RedemptionQuote {
  readonly mode: RedemptionMode
  readonly amountPaise: bigint
  /** Portion that reduces Total Investment. */
  readonly principalComponentPaise: bigint
  /** Portion drawn from allocated gains. */
  readonly returnsComponentPaise: bigint
}

/**
 * Split a redemption into its principal and returns components (Option B module
 * 1: "the principal component of the redemption should reduce this figure").
 *
 * Returns are consumed first, so a `returns_only` redemption never touches
 * principal and a partial redemption reduces principal only once gains are
 * exhausted. A redemption may not exceed the current value, and a loss-making
 * portfolio (return <= 0) has no returns component to draw on.
 */
export const quoteRedemption = (
  summary: PortfolioSummary,
  mode: RedemptionMode,
  customAmountPaise?: bigint,
): RedemptionQuote => {
  const available = summary.currentValuePaise
  if (available <= 0n) {
    throw new Error("no redeemable value")
  }
  const gains = summary.totalReturnPaise > 0n ? summary.totalReturnPaise : 0n

  let amountPaise: bigint
  switch (mode) {
    case "full":
      amountPaise = available
      break
    case "returns_only":
      if (gains <= 0n) throw new Error("no returns to redeem")
      amountPaise = gains
      break
    case "half":
      amountPaise = available / 2n
      break
    case "custom":
      if (customAmountPaise === undefined) throw new Error("custom redemption needs an amount")
      amountPaise = customAmountPaise
      break
  }

  if (amountPaise <= 0n) throw new Error("redemption amount must be positive")
  if (amountPaise > available) throw new Error("redemption exceeds available value")

  const returnsComponentPaise = amountPaise < gains ? amountPaise : gains
  const principalComponentPaise = amountPaise - returnsComponentPaise
  return { mode, amountPaise, principalComponentPaise, returnsComponentPaise }
}

export interface AumUpdateInput {
  readonly openingAumPaise: bigint
  readonly newInvestmentsPaise: bigint
  readonly redemptionsPaise: bigint
  /** Signed: a loss is negative. */
  readonly portfolioGainPaise: bigint
}

/**
 * Monthly AUM identity (Option B module 5). The closing figure is always derived,
 * never typed by hand, and can never be negative.
 */
export const deriveClosingAum = (input: AumUpdateInput): bigint => {
  const closing =
    input.openingAumPaise + input.newInvestmentsPaise - input.redemptionsPaise + input.portfolioGainPaise
  if (closing < 0n) throw new Error("closing AUM cannot be negative")
  return closing
}
