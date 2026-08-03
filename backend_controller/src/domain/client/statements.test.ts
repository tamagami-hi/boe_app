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
  amountPaise: 0n,
  ...overrides,
})

const contribution = (effectiveDate: string, paise: bigint): LedgerEntry =>
  entry({
    entryType: "lump_sum",
    effectiveDate,
    principalDeltaPaise: paise,
    valueDeltaPaise: paise,
    amountPaise: paise,
  })

const gain = (effectiveDate: string, paise: bigint): LedgerEntry =>
  entry({
    entryType: "gain_allocation",
    effectiveDate,
    principalDeltaPaise: 0n,
    valueDeltaPaise: paise,
    amountPaise: paise < 0n ? -paise : paise,
  })

const redemption = (effectiveDate: string, paise: bigint, principal: bigint): LedgerEntry =>
  entry({
    entryType: "redemption",
    effectiveDate,
    principalDeltaPaise: -principal,
    valueDeltaPaise: -paise,
    amountPaise: paise,
  })

describe("deriveStatements", () => {
  test("no ledger means no statements", () => {
    expect(deriveStatements([])).toEqual([])
  })

  test("carries the closing value into the next month's opening", () => {
    // ₹10,50,000 in during July, ₹1,88,450 of growth in August: the model
    // document's example, spread over two periods.
    const periods = deriveStatements([
      contribution("2026-07-15", 105_000_000n),
      gain("2026-08-31", 18_845_000n),
    ])

    expect(periods).toHaveLength(2)
    expect(periods[0]).toMatchObject({
      period: "2026-07",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      openingValuePaise: 0n,
      contributionsPaise: 105_000_000n,
      returnsPaise: 0n,
      closingValuePaise: 105_000_000n,
      totalInvestmentPaise: 105_000_000n,
    })
    expect(periods[1]).toMatchObject({
      period: "2026-08",
      openingValuePaise: 105_000_000n,
      returnsPaise: 18_845_000n,
      closingValuePaise: 123_845_000n,
      // A gain moves no principal, so total investment is unchanged.
      totalInvestmentPaise: 105_000_000n,
    })
  })

  test("a payout reduces the closing value and only its principal share the investment", () => {
    const periods = deriveStatements([
      contribution("2026-07-01", 105_000_000n),
      gain("2026-07-20", 18_845_000n),
      redemption("2026-07-28", 30_000_000n, 11_155_000n),
    ])

    expect(periods).toHaveLength(1)
    expect(periods[0]).toMatchObject({
      contributionsPaise: 105_000_000n,
      returnsPaise: 18_845_000n,
      withdrawalsPaise: 30_000_000n,
      closingValuePaise: 93_845_000n,
      totalInvestmentPaise: 93_845_000n,
      entryCount: 3,
    })
  })

  test("the closing identity holds for every period", () => {
    const periods = deriveStatements([
      contribution("2026-01-10", 50_000_000n),
      gain("2026-02-28", 2_000_000n),
      redemption("2026-03-05", 1_000_000n, 0n),
      contribution("2026-03-20", 25_000_000n),
      gain("2026-04-30", -500_000n),
    ])

    for (const period of periods) {
      expect(period.closingValuePaise).toBe(
        period.openingValuePaise +
          period.contributionsPaise +
          period.returnsPaise -
          period.withdrawalsPaise,
      )
    }
    // A loss nets the period's return negative rather than showing a withdrawal.
    expect(periods.at(-1)).toMatchObject({ returnsPaise: -500_000n, withdrawalsPaise: 0n })
  })

  test("months are ordered oldest first and short months end correctly", () => {
    const periods = deriveStatements([
      gain("2026-03-31", 100n),
      contribution("2026-02-05", 1_000n),
      gain("2027-02-10", 100n),
    ])
    expect(periods.map((p) => p.period)).toEqual(["2026-02", "2026-03", "2027-02"])
    expect(periods[0]?.periodEnd).toBe("2026-02-28")
    // 2028 is a leap year; the boundary must not be hard-coded.
    expect(deriveStatements([gain("2028-02-01", 1n)])[0]?.periodEnd).toBe("2028-02-29")
  })

  test("a back-dated correction lands in the month it belongs to", () => {
    const periods = deriveStatements([
      contribution("2026-05-01", 10_000_000n),
      entry({
        entryType: "adjustment",
        effectiveDate: "2026-05-15",
        principalDeltaPaise: 0n,
        valueDeltaPaise: 250_000n,
        amountPaise: 250_000n,
      }),
    ])
    expect(periods).toHaveLength(1)
    expect(periods[0]).toMatchObject({ returnsPaise: 250_000n, closingValuePaise: 10_250_000n })
  })
})
