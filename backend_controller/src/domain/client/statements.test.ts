import { describe, expect, test } from "vitest"

import type { LedgerEntry } from "./portfolioLedger.js"
import { deriveStatements } from "./statements.js"

const entry = (
  overrides: Partial<LedgerEntry> & Pick<LedgerEntry, "entryType" | "effectiveDate">,
): LedgerEntry => ({
  id: `entry-${overrides.effectiveDate}-${overrides.entryType}`,
  fundId: "fund-1",
  principalDeltaPaise: 0n,
  valueDeltaPaise: 0n,
  ...overrides,
})

const contribution = (effectiveDate: string, paise: bigint): LedgerEntry =>
  entry({
    entryType: "contribution",
    effectiveDate,
    principalDeltaPaise: paise,
    valueDeltaPaise: paise,
  })

const growth = (effectiveDate: string, paise: bigint): LedgerEntry =>
  entry({
    entryType: "growth_adjustment",
    effectiveDate,
    principalDeltaPaise: 0n,
    valueDeltaPaise: paise,
  })

const reversal = (effectiveDate: string, valuePaise: bigint, principalPaise: bigint): LedgerEntry =>
  entry({
    entryType: "reversal",
    effectiveDate,
    principalDeltaPaise: -principalPaise,
    valueDeltaPaise: -valuePaise,
  })

describe("deriveStatements", () => {
  test("no ledger means no statements", () => {
    expect(deriveStatements([])).toEqual([])
  })

  test("carries the closing value into the next month's opening", () => {
    // ₹10,50,000 in during July, ₹1,88,450 of growth in August.
    const periods = deriveStatements([
      contribution("2026-07-15", 105_000_000n),
      growth("2026-08-31", 18_845_000n),
    ])

    expect(periods).toHaveLength(2)
    expect(periods[0]).toMatchObject({
      period: "2026-07",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      openingValuePaise: 0n,
      contributionsPaise: 105_000_000n,
      growthPaise: 0n,
      reversalsPaise: 0n,
      closingValuePaise: 105_000_000n,
      totalInvestmentPaise: 105_000_000n,
    })
    expect(periods[1]).toMatchObject({
      period: "2026-08",
      openingValuePaise: 105_000_000n,
      growthPaise: 18_845_000n,
      closingValuePaise: 123_845_000n,
      // Growth moves no principal, so total investment is unchanged.
      totalInvestmentPaise: 105_000_000n,
    })
  })

  test("a reversal is its own signed bucket and only its principal share moves investment", () => {
    const periods = deriveStatements([
      contribution("2026-07-01", 105_000_000n),
      growth("2026-07-20", 18_845_000n),
      reversal("2026-07-28", 30_000_000n, 11_155_000n),
    ])

    expect(periods).toHaveLength(1)
    expect(periods[0]).toMatchObject({
      contributionsPaise: 105_000_000n,
      growthPaise: 18_845_000n,
      reversalsPaise: -30_000_000n,
      closingValuePaise: 93_845_000n,
      totalInvestmentPaise: 93_845_000n,
      entryCount: 3,
    })
  })

  test("the closing identity holds for every period", () => {
    const periods = deriveStatements([
      contribution("2026-01-10", 50_000_000n),
      growth("2026-02-28", 2_000_000n),
      reversal("2026-03-05", 1_000_000n, 0n),
      contribution("2026-03-20", 25_000_000n),
      growth("2026-04-30", -500_000n),
    ])

    for (const period of periods) {
      expect(period.closingValuePaise).toBe(
        period.openingValuePaise + period.contributionsPaise + period.growthPaise + period.reversalsPaise,
      )
    }
    // A loss nets the period's growth negative rather than showing a reversal.
    expect(periods.at(-1)).toMatchObject({ growthPaise: -500_000n, reversalsPaise: 0n })
  })

  test("months are ordered oldest first and short months end correctly", () => {
    const periods = deriveStatements([
      growth("2026-03-31", 100n),
      contribution("2026-02-05", 1_000n),
      growth("2027-02-10", 100n),
    ])
    expect(periods.map((p) => p.period)).toEqual(["2026-02", "2026-03", "2027-02"])
    expect(periods[0]?.periodEnd).toBe("2026-02-28")
    // 2028 is a leap year; the boundary must not be hard-coded.
    expect(deriveStatements([growth("2028-02-01", 1n)])[0]?.periodEnd).toBe("2028-02-29")
  })

  test("a back-dated correction lands in the month it belongs to", () => {
    const periods = deriveStatements([
      contribution("2026-05-01", 10_000_000n),
      growth("2026-05-15", 250_000n),
    ])
    expect(periods).toHaveLength(1)
    expect(periods[0]).toMatchObject({ growthPaise: 250_000n, closingValuePaise: 10_250_000n })
  })
})
