import { describe, expect, it } from "vitest"

import { parseNonZeroSignedRupees, parseRupeesToSafePaise } from "./rupeeAmount"

describe("rupee amounts typed into fund and AUM fields", () => {
  it("keeps the sign of an adjustment and refuses a zero or doubled sign", () => {
    expect(parseNonZeroSignedRupees("12.34")).toBe("1234")
    expect(parseNonZeroSignedRupees("-12.34")).toBe("-1234")
    expect(parseNonZeroSignedRupees("-0.01")).toBe("-1")
    for (const text of ["0", "-0", "0.00", "-0.00", "-", "--1", "- 1", "1-"]) {
      expect(parseNonZeroSignedRupees(text), text).toBeNull()
    }
  })

  it("gives fund minimums as a number only while the paise stay exact", () => {
    expect(parseRupeesToSafePaise("0")).toBe(0)
    expect(parseRupeesToSafePaise("500.75")).toBe(50_075)
    expect(parseRupeesToSafePaise("90071992547409.91")).toBe(9_007_199_254_740_991)
    expect(parseRupeesToSafePaise("90071992547409.92")).toBeNull()
  })
})
