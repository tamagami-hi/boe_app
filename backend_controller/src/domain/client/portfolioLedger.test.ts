/**
 * Option B derivation tests. The headline case is the worked example from the
 * model document: ₹4,50,000 of SIP over 18 months plus ₹6,00,000 across three
 * lump sums, with allocated gains bringing the value to ₹12,38,450 — a return of
 * ₹1,88,450 (+17.95%).
 */
import { describe, expect, test } from "vitest"

import {
  deriveClosingAum,
  derivePortfolio,
  quoteRedemption,
  returnPercent,
  type LedgerEntry,
} from "./portfolioLedger.js"

const rupees = (value: number): bigint => BigInt(Math.round(value * 100))

let sequence = 0
const contribution = (
  entryType: "sip_installment" | "lump_sum",
  amountRupees: number,
  effectiveDate: string,
): LedgerEntry => {
  sequence += 1
  const amountPaise = rupees(amountRupees)
  return {
    id: `entry-${sequence}`,
    fundId: "fund-1",
    entryType,
    principalDeltaPaise: amountPaise,
    valueDeltaPaise: amountPaise,
    amountPaise,
    effectiveDate,
  }
}

const gain = (amountRupees: number, effectiveDate: string): LedgerEntry => {
  sequence += 1
  const amountPaise = rupees(Math.abs(amountRupees))
  return {
    id: `entry-${sequence}`,
    fundId: "fund-1",
    entryType: "gain_allocation",
    principalDeltaPaise: 0n,
    valueDeltaPaise: amountRupees < 0 ? -amountPaise : amountPaise,
    amountPaise,
    effectiveDate,
  }
}

const redemption = (
  amountRupees: number,
  principalRupees: number,
  effectiveDate: string,
): LedgerEntry => {
  sequence += 1
  const amountPaise = rupees(amountRupees)
  return {
    id: `entry-${sequence}`,
    fundId: "fund-1",
    entryType: "redemption",
    principalDeltaPaise: -rupees(principalRupees),
    valueDeltaPaise: -amountPaise,
    amountPaise,
    effectiveDate,
  }
}

describe("derivePortfolio", () => {
  test("derives the model document's dashboard from the ledger", () => {
    const entries: LedgerEntry[] = []
    // 18 monthly SIP installments of ₹25,000 from 05 Feb 2025.
    for (let month = 0; month < 18; month += 1) {
      const date = new Date(Date.UTC(2025, 1 + month, 5)).toISOString().slice(0, 10)
      entries.push(contribution("sip_installment", 25000, date))
    }
    // Three lump sums totalling ₹6,00,000, the first on 01 April 2025.
    entries.push(contribution("lump_sum", 500000, "2025-04-01"))
    entries.push(contribution("lump_sum", 50000, "2026-04-20"))
    entries.push(contribution("lump_sum", 50000, "2026-06-15"))
    // Administrator-allocated growth for this investor.
    entries.push(gain(188450, "2026-07-31"))

    const summary = derivePortfolio(entries)

    expect(summary.sipInstallmentCount).toBe(18)
    expect(summary.sipTotalPaise).toBe(rupees(450000))
    expect(summary.lumpSumCount).toBe(3)
    expect(summary.lumpSumTotalPaise).toBe(rupees(600000))
    expect(summary.totalInvestmentPaise).toBe(rupees(1050000))
    expect(summary.currentValuePaise).toBe(rupees(1238450))
    expect(summary.totalReturnPaise).toBe(rupees(188450))
    expect(summary.returnPercent).toBe(17.95)
    expect(summary.allocatedGainPaise).toBe(rupees(188450))
    // The earliest *contribution* dates the "return since" line, not the earliest event.
    expect(summary.firstInvestmentDate).toBe("2025-02-05")
    expect(summary.lastActivityDate).toBe("2026-07-31")
  })

  test("an empty ledger derives zeros and no percentage", () => {
    const summary = derivePortfolio([])
    expect(summary.totalInvestmentPaise).toBe(0n)
    expect(summary.currentValuePaise).toBe(0n)
    expect(summary.totalReturnPaise).toBe(0n)
    expect(summary.returnPercent).toBeNull()
    expect(summary.firstInvestmentDate).toBeNull()
  })

  test("a redemption reduces value fully and principal only by its principal part", () => {
    const summary = derivePortfolio([
      contribution("lump_sum", 100000, "2026-01-01"),
      gain(20000, "2026-02-01"),
      // ₹30,000 out: ₹20,000 of it is gains, ₹10,000 is principal.
      redemption(30000, 10000, "2026-03-01"),
    ])
    expect(summary.totalInvestmentPaise).toBe(rupees(90000))
    expect(summary.currentValuePaise).toBe(rupees(90000))
    expect(summary.totalReturnPaise).toBe(0n)
    expect(summary.redemptionCount).toBe(1)
    expect(summary.redeemedTotalPaise).toBe(rupees(30000))
  })

  test("an allocated loss reduces value below the invested principal", () => {
    const summary = derivePortfolio([
      contribution("lump_sum", 100000, "2026-01-01"),
      gain(-15000, "2026-02-01"),
    ])
    expect(summary.currentValuePaise).toBe(rupees(85000))
    expect(summary.totalReturnPaise).toBe(rupees(-15000))
    expect(summary.returnPercent).toBe(-15)
    expect(summary.allocatedGainPaise).toBe(rupees(-15000))
  })

  test("the fold is order-independent", () => {
    const entries = [
      contribution("lump_sum", 100000, "2026-01-01"),
      gain(5000, "2026-02-01"),
      redemption(20000, 15000, "2026-03-01"),
    ]
    const forward = derivePortfolio(entries)
    const reversed = derivePortfolio([...entries].reverse())
    expect(reversed.totalInvestmentPaise).toBe(forward.totalInvestmentPaise)
    expect(reversed.currentValuePaise).toBe(forward.currentValuePaise)
    expect(reversed.firstInvestmentDate).toBe(forward.firstInvestmentDate)
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

describe("quoteRedemption", () => {
  const summary = derivePortfolio([
    contribution("lump_sum", 100000, "2026-01-01"),
    gain(25000, "2026-02-01"),
  ])

  test("full redemption takes the whole current value", () => {
    const quote = quoteRedemption(summary, "full")
    expect(quote.amountPaise).toBe(rupees(125000))
    expect(quote.returnsComponentPaise).toBe(rupees(25000))
    expect(quote.principalComponentPaise).toBe(rupees(100000))
  })

  test("returns-only redemption never touches principal", () => {
    const quote = quoteRedemption(summary, "returns_only")
    expect(quote.amountPaise).toBe(rupees(25000))
    expect(quote.returnsComponentPaise).toBe(rupees(25000))
    expect(quote.principalComponentPaise).toBe(0n)
  })

  test("half redemption draws gains first, then principal", () => {
    const quote = quoteRedemption(summary, "half")
    expect(quote.amountPaise).toBe(rupees(62500))
    expect(quote.returnsComponentPaise).toBe(rupees(25000))
    expect(quote.principalComponentPaise).toBe(rupees(37500))
  })

  test("custom redemption below the gain balance is all returns", () => {
    const quote = quoteRedemption(summary, "custom", rupees(10000))
    expect(quote.returnsComponentPaise).toBe(rupees(10000))
    expect(quote.principalComponentPaise).toBe(0n)
  })

  test("rejects amounts above the available value, and returns-only with no gains", () => {
    expect(() => quoteRedemption(summary, "custom", rupees(200000))).toThrow(/exceeds available/u)
    expect(() => quoteRedemption(summary, "custom", 0n)).toThrow(/must be positive/u)
    expect(() => quoteRedemption(summary, "custom")).toThrow(/needs an amount/u)

    const noGains = derivePortfolio([contribution("lump_sum", 50000, "2026-01-01")])
    expect(() => quoteRedemption(noGains, "returns_only")).toThrow(/no returns/u)

    const empty = derivePortfolio([])
    expect(() => quoteRedemption(empty, "full")).toThrow(/no redeemable value/u)
  })

  test("a loss-making portfolio has no returns component to draw on", () => {
    const losing = derivePortfolio([
      contribution("lump_sum", 100000, "2026-01-01"),
      gain(-20000, "2026-02-01"),
    ])
    const quote = quoteRedemption(losing, "full")
    expect(quote.amountPaise).toBe(rupees(80000))
    expect(quote.returnsComponentPaise).toBe(0n)
    expect(quote.principalComponentPaise).toBe(rupees(80000))
  })
})

describe("deriveClosingAum", () => {
  test("applies the monthly identity from the document", () => {
    // ₹10.00 Cr + ₹25 L - ₹10 L + ₹20 L = ₹10.35 Cr
    const closing = deriveClosingAum({
      openingAumPaise: rupees(100000000),
      newInvestmentsPaise: rupees(2500000),
      redemptionsPaise: rupees(1000000),
      portfolioGainPaise: rupees(2000000),
    })
    expect(closing).toBe(rupees(103500000))
  })

  test("a loss reduces the closing figure and cannot drive it negative", () => {
    expect(
      deriveClosingAum({
        openingAumPaise: rupees(1000),
        newInvestmentsPaise: 0n,
        redemptionsPaise: 0n,
        portfolioGainPaise: rupees(-400),
      }),
    ).toBe(rupees(600))

    expect(() =>
      deriveClosingAum({
        openingAumPaise: rupees(100),
        newInvestmentsPaise: 0n,
        redemptionsPaise: rupees(500),
        portfolioGainPaise: 0n,
      }),
    ).toThrow(/cannot be negative/u)
  })
})
