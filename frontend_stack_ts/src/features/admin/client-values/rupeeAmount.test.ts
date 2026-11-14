import { describe, expect, it } from "vitest"

import { parseNonZeroSignedRupees, parseRupees, parseRupeesToSafePaise } from "./rupeeAmount"

const NOT_RUPEES = ["", " ", "abc", "1e3", "1,000", " 5", "5 ", "5.", ".5", "+5", "05", "NaN", "Infinity", "₹5", "5..0"]
const TOO_PRECISE = ["1.234", "0.001", "100.999", "12.345"]

describe("rupee amounts typed into fund and AUM fields", () => {
  it("converts rupees to exact paise without floating point", () => {
    expect(parseRupees("0")).toBe("0")
    expect(parseRupees("0.01")).toBe("1")
    expect(parseRupees("0.1")).toBe("10")
    expect(parseRupees("12.05")).toBe("1205")
    expect(parseRupees("12.5")).toBe("1250")
    expect(parseRupees("1000000")).toBe("100000000")
    expect(parseRupees("0.29")).toBe("29")
    expect(parseRupees("90071992547409.93")).toBe("9007199254740993")
  })

  it("refuses more than two decimal places and anything that is not plain rupees", () => {
    for (const text of [...NOT_RUPEES, ...TOO_PRECISE]) {
      expect(parseRupees(text), JSON.stringify(text)).toBeNull()
      expect(parseRupeesToSafePaise(text), JSON.stringify(text)).toBeNull()
      expect(parseNonZeroSignedRupees(text), JSON.stringify(text)).toBeNull()
      expect(parseNonZeroSignedRupees(`-${text}`), JSON.stringify(`-${text}`)).toBeNull()
    }
  })

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
