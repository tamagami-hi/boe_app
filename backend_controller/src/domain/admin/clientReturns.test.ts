import { describe, expect, test } from "vitest"

import { investorCashFlowOf, summarizeClientReturns, type LedgerFact } from "./clientReturns.js"

const RECORDED_AT = new Date("2026-01-01T00:00:00.000Z")

const fact = (overrides: Partial<LedgerFact> & Pick<LedgerFact, "entryType" | "effectiveDate">): LedgerFact => ({
  reversedEntryType: null,
  principalDeltaPaise: 0n,
  valueDeltaPaise: 0n,
  lastCreatedAt: RECORDED_AT,
  ...overrides,
})

const contribution = (paise: bigint, effectiveDate: string, lastCreatedAt = RECORDED_AT): LedgerFact =>
  fact({ entryType: "contribution", principalDeltaPaise: paise, valueDeltaPaise: paise, effectiveDate, lastCreatedAt })

const growth = (paise: bigint, effectiveDate: string): LedgerFact =>
  fact({ entryType: "growth_adjustment", valueDeltaPaise: paise, effectiveDate })

const withdrawal = (principalPaise: bigint, valuePaise: bigint, effectiveDate: string): LedgerFact =>
  fact({ entryType: "withdrawal", principalDeltaPaise: -principalPaise, valueDeltaPaise: -valuePaise, effectiveDate })

const reversalOf = (original: LedgerFact): LedgerFact =>
  fact({
    entryType: "reversal",
    reversedEntryType: original.entryType,
    principalDeltaPaise: -original.principalDeltaPaise,
    valueDeltaPaise: -original.valueDeltaPaise,
    effectiveDate: original.effectiveDate,
  })

describe("summarizeClientReturns", () => {
  test("reports invested, value, growth, simple return and XIRR for a 10% year", () => {
    const summary = summarizeClientReturns(
      [contribution(100_000n, "2023-01-01"), growth(10_000n, "2023-07-01")],
      "2024-01-01",
    )
    expect(summary).toEqual({
      investedPaise: 100_000n,
      currentValuePaise: 110_000n,
      growthPaise: 10_000n,
      simpleReturnBasisPoints: 1000n,
      xirrBasisPoints: 1000n,
      lastUpdatedAt: RECORDED_AT,
    })
  })

  test("treats withdrawals as investor inflows on their effective dates", () => {
    const summary = summarizeClientReturns(
      [
        contribution(1_000_000n, "2008-01-01"),
        withdrawal(275_000n, 275_000n, "2008-03-01"),
        growth(300_000n, "2008-06-01"),
        withdrawal(425_000n, 425_000n, "2008-10-30"),
        withdrawal(0n, 325_000n, "2009-02-15"),
      ],
      "2009-04-01",
    )
    expect(summary.investedPaise).toBe(300_000n)
    expect(summary.currentValuePaise).toBe(275_000n)
    expect(summary.growthPaise).toBe(-25_000n)
    expect(summary.simpleReturnBasisPoints).toBe(-833n)
    expect(summary.xirrBasisPoints).toBe(3734n)
  })

  test("a reversed contribution and a reversed withdrawal leave no cash flow", () => {
    const extra = contribution(50_000n, "2023-03-01")
    const payout = withdrawal(0n, 5_000n, "2023-09-01")
    const summary = summarizeClientReturns(
      [contribution(100_000n, "2023-01-01"), extra, reversalOf(extra), growth(10_000n, "2023-07-01"), payout, reversalOf(payout)],
      "2024-01-01",
    )
    expect(summary.investedPaise).toBe(100_000n)
    expect(summary.currentValuePaise).toBe(110_000n)
    expect(summary.xirrBasisPoints).toBe(1000n)
  })

  test("growth, its reversal and a maturity reinvestment are not cash flows", () => {
    const bump = growth(20_000n, "2023-05-01")
    expect(investorCashFlowOf(bump)).toBe(0n)
    expect(investorCashFlowOf(reversalOf(bump))).toBe(0n)
    expect(
      investorCashFlowOf(fact({ entryType: "maturity_reinvestment", principalDeltaPaise: 10_000n, effectiveDate: "2023-06-01" })),
    ).toBe(0n)
    expect(investorCashFlowOf(contribution(7n, "2023-06-01"))).toBe(-7n)
    expect(investorCashFlowOf(withdrawal(1n, 3n, "2023-06-01"))).toBe(3n)
  })

  test("a single-day history has a simple return but no XIRR", () => {
    const summary = summarizeClientReturns(
      [contribution(100_000n, "2026-11-13"), growth(1_000n, "2026-11-13")],
      "2026-11-13",
    )
    expect(summary.simpleReturnBasisPoints).toBe(100n)
    expect(summary.xirrBasisPoints).toBeNull()
  })

  test("XIRR needs 30 days from the first contribution", () => {
    const facts = [contribution(100_000n, "2026-10-14"), growth(1_000n, "2026-11-01")]
    expect(summarizeClientReturns(facts, "2026-11-12").xirrBasisPoints).toBeNull()
    expect(summarizeClientReturns(facts, "2026-11-13").xirrBasisPoints).not.toBeNull()
  })

  test("zero invested gives null returns, and an empty ledger reads as nothing", () => {
    const original = contribution(100_000n, "2023-01-01")
    expect(summarizeClientReturns([original, reversalOf(original)], "2024-01-01")).toMatchObject({
      investedPaise: 0n,
      currentValuePaise: 0n,
      simpleReturnBasisPoints: null,
      xirrBasisPoints: null,
    })
    expect(summarizeClientReturns([], "2024-01-01")).toEqual({
      investedPaise: 0n,
      currentValuePaise: 0n,
      growthPaise: 0n,
      simpleReturnBasisPoints: null,
      xirrBasisPoints: null,
      lastUpdatedAt: null,
    })
  })

  test("rounds the simple return half away from zero in basis points", () => {
    expect(summarizeClientReturns([contribution(3n, "2023-01-01"), growth(2n, "2023-02-01")], "2023-01-01").simpleReturnBasisPoints).toBe(6667n)
    expect(summarizeClientReturns([contribution(3n, "2023-01-01"), growth(-2n, "2023-02-01")], "2023-01-01").simpleReturnBasisPoints).toBe(-6667n)
    expect(summarizeClientReturns([contribution(20_000n, "2023-01-01"), growth(1n, "2023-02-01")], "2023-01-01").simpleReturnBasisPoints).toBe(1n)
    expect(summarizeClientReturns([contribution(20_000n, "2023-01-01"), growth(-1n, "2023-02-01")], "2023-01-01").simpleReturnBasisPoints).toBe(-1n)
  })

  test("last updated is the latest recorded time, not the latest effective date", () => {
    const later = new Date("2026-03-01T10:00:00.000Z")
    const summary = summarizeClientReturns(
      [contribution(100n, "2025-12-01", later), contribution(100n, "2026-02-01")],
      "2026-11-13",
    )
    expect(summary.lastUpdatedAt).toEqual(later)
  })
})
