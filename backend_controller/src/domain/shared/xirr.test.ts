import { describe, expect, test } from "vitest"

import { annualisedReturnBasisPoints, daysBetween, netFlowsByDate } from "./xirr.js"

describe("annualisedReturnBasisPoints", () => {
  test("matches the published spreadsheet XIRR reference of 37.34%", () => {
    expect(
      annualisedReturnBasisPoints([
        { date: "2008-01-01", amountPaise: -1_000_000n },
        { date: "2008-03-01", amountPaise: 275_000n },
        { date: "2008-10-30", amountPaise: 425_000n },
        { date: "2009-02-15", amountPaise: 325_000n },
        { date: "2009-04-01", amountPaise: 275_000n },
      ]),
    ).toBe(3734n)
  })

  test("returns exactly 10% for a 10% gain over 365 days, in any input order", () => {
    expect(
      annualisedReturnBasisPoints([
        { date: "2024-01-01", amountPaise: 110_000n },
        { date: "2023-01-01", amountPaise: -100_000n },
      ]),
    ).toBe(1000n)
  })

  test("annualises a loss symmetrically", () => {
    expect(
      annualisedReturnBasisPoints([
        { date: "2023-01-01", amountPaise: -100_000n },
        { date: "2024-01-01", amountPaise: 80_000n },
      ]),
    ).toBe(-2000n)
  })

  test("is undefined without both an outflow and an inflow", () => {
    expect(annualisedReturnBasisPoints([])).toBeNull()
    expect(annualisedReturnBasisPoints([{ date: "2023-01-01", amountPaise: -100_000n }])).toBeNull()
    expect(
      annualisedReturnBasisPoints([
        { date: "2023-01-01", amountPaise: 100_000n },
        { date: "2024-01-01", amountPaise: 5_000n },
      ]),
    ).toBeNull()
  })

  test("is undefined when the root lies outside the searched range", () => {
    expect(
      annualisedReturnBasisPoints([
        { date: "2023-01-01", amountPaise: -1n },
        { date: "2023-01-02", amountPaise: 9_000_000_000_000n },
      ]),
    ).toBeNull()
  })
})

describe("netFlowsByDate", () => {
  test("sums same-day flows, drops zero days and sorts by date", () => {
    expect(
      netFlowsByDate([
        { date: "2024-02-01", amountPaise: 500n },
        { date: "2024-01-01", amountPaise: -300n },
        { date: "2024-02-01", amountPaise: -500n },
        { date: "2024-01-01", amountPaise: -200n },
      ]),
    ).toEqual([{ date: "2024-01-01", amountPaise: -500n }])
  })

  test("counts calendar days across a leap year", () => {
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366)
    expect(daysBetween("2025-11-13", "2026-11-13")).toBe(365)
  })
})
