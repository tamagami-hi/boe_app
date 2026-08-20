/**
 * Derivation tests over the client value ledger. The headline case: ₹10,50,000
 * of contributions with growth adjustments bringing the value to ₹12,38,450 —
 * a growth of ₹1,88,450 (+17.95%).
 */
import { describe, expect, test } from "vitest"

import { derivePortfolio, returnPercent, type LedgerEntry } from "./portfolioLedger.js"

const rupees = (value: number): bigint => BigInt(Math.round(value * 100))

let sequence = 0
const contribution = (amountRupees: number, effectiveDate: string): LedgerEntry => {
  sequence += 1
  const amountPaise = rupees(amountRupees)
  return {
    id: `entry-${sequence}`,
    fundId: "fund-1",
    entryType: "contribution",
    principalDeltaPaise: amountPaise,
    valueDeltaPaise: amountPaise,
    effectiveDate,
  }
}

const growth = (amountRupees: number, effectiveDate: string): LedgerEntry => {
  sequence += 1
  const amountPaise = rupees(Math.abs(amountRupees))
  return {
    id: `entry-${sequence}`,
    fundId: "fund-1",
    entryType: "growth_adjustment",
    principalDeltaPaise: 0n,
    valueDeltaPaise: amountRupees < 0 ? -amountPaise : amountPaise,
    effectiveDate,
  }
}

const reversal = (principalRupees: number, valueRupees: number, effectiveDate: string): LedgerEntry => {
  sequence += 1
  return {
    id: `entry-${sequence}`,
    fundId: "fund-1",
    entryType: "reversal",
    principalDeltaPaise: -rupees(principalRupees),
    valueDeltaPaise: -rupees(valueRupees),
    effectiveDate,
  }
}

describe("derivePortfolio", () => {
  test("derives the dashboard from the value ledger", () => {
    const entries: LedgerEntry[] = [
      contribution(450000, "2025-02-05"),
      contribution(500000, "2025-04-01"),
      contribution(100000, "2026-06-15"),
      growth(188450, "2026-07-31"),
    ]

    const summary = derivePortfolio(entries)

    expect(summary.contributionCount).toBe(3)
    expect(summary.contributionTotalPaise).toBe(rupees(1050000))
    expect(summary.totalInvestmentPaise).toBe(rupees(1050000))
    expect(summary.currentValuePaise).toBe(rupees(1238450))
    expect(summary.totalGrowthPaise).toBe(rupees(188450))
    expect(summary.returnPercent).toBe(17.95)
    expect(summary.growthAdjustmentTotalPaise).toBe(rupees(188450))
    expect(summary.reversalCount).toBe(0)
    // The earliest *contribution* dates the "return since" line, not the earliest event.
    expect(summary.firstContributionDate).toBe("2025-02-05")
    expect(summary.lastActivityDate).toBe("2026-07-31")
  })

  test("an empty ledger derives zeros and no percentage", () => {
    const summary = derivePortfolio([])
    expect(summary.totalInvestmentPaise).toBe(0n)
    expect(summary.currentValuePaise).toBe(0n)
    expect(summary.totalGrowthPaise).toBe(0n)
    expect(summary.returnPercent).toBeNull()
    expect(summary.firstContributionDate).toBeNull()
  })

  test("a reversal reduces value fully and principal by its principal part", () => {
    const summary = derivePortfolio([
      contribution(100000, "2026-01-01"),
      growth(20000, "2026-02-01"),
      reversal(10000, 30000, "2026-03-01"),
    ])
    expect(summary.totalInvestmentPaise).toBe(rupees(90000))
    expect(summary.currentValuePaise).toBe(rupees(90000))
    expect(summary.totalGrowthPaise).toBe(0n)
    expect(summary.reversalCount).toBe(1)
  })

  test("a negative growth adjustment reduces value below the invested principal", () => {
    const summary = derivePortfolio([contribution(100000, "2026-01-01"), growth(-15000, "2026-02-01")])
    expect(summary.currentValuePaise).toBe(rupees(85000))
    expect(summary.totalGrowthPaise).toBe(rupees(-15000))
    expect(summary.returnPercent).toBe(-15)
    expect(summary.growthAdjustmentTotalPaise).toBe(rupees(-15000))
  })

  test("the fold is order-independent", () => {
    const entries = [
      contribution(100000, "2026-01-01"),
      growth(5000, "2026-02-01"),
      reversal(15000, 20000, "2026-03-01"),
    ]
    const forward = derivePortfolio(entries)
    const reversed = derivePortfolio([...entries].reverse())
    expect(reversed.totalInvestmentPaise).toBe(forward.totalInvestmentPaise)
    expect(reversed.currentValuePaise).toBe(forward.currentValuePaise)
    expect(reversed.firstContributionDate).toBe(forward.firstContributionDate)
    expect(reversed.lastActivityDate).toBe(forward.lastActivityDate)
  })
})

describe("returnPercent", () => {
  test("rounds to two decimals and refuses to divide by zero principal", () => {
    expect(returnPercent(rupees(188450), rupees(1050000))).toBe(17.95)
    expect(returnPercent(rupees(1), rupees(3))).toBe(33.33)
    expect(returnPercent(rupees(100), 0n)).toBeNull()
    expect(returnPercent(0n, rupees(1000))).toBe(0)
  })
})
