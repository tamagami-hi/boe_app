import { describe, expect, it } from "vitest"

import {
  MoneyFormatError,
  MoneyPrecisionError,
  addPaise,
  comparePaise,
  formatINR,
  isPaise,
  isWirePaise,
  paiseToRupees,
  rupeesToPaise,
  subtractPaise,
  toPaise,
} from "./money.js"

describe("paise recognition", () => {
  it("accepts integer paise strings", () => {
    for (const value of ["0", "1", "200", "1500000", "-250"]) {
      expect(isPaise(value), value).toBe(true)
    }
  })

  it("rejects anything that is not an integer paise string", () => {
    for (const value of ["", " ", "1.5", "1e3", "01", "+1", "abc", "1 ", null, undefined, 200, 1.5]) {
      expect(isPaise(value), String(value)).toBe(false)
    }
  })

  it("rejects values beyond the PostgreSQL bigint range", () => {
    expect(isPaise("9223372036854775807")).toBe(true)
    expect(isPaise("9223372036854775808")).toBe(false)
  })

  it("accepts paise above the safe integer range, because the column is bigint", () => {
    expect(isPaise("9007199254740993")).toBe(true)
  })

  it("separates the unsigned wire form from signed computed amounts", () => {
    expect(isWirePaise("200")).toBe(true)
    expect(isWirePaise("-200")).toBe(false)
    expect(isPaise("-200")).toBe(true)
  })

  it("throws on a malformed paise string", () => {
    expect(() => toPaise("1.5")).toThrow(MoneyFormatError)
  })
})

describe("rupee to paise conversion at the request boundary", () => {
  it("converts whole and fractional rupees", () => {
    expect(rupeesToPaise(2)).toBe("200")
    expect(rupeesToPaise(1)).toBe("100")
    expect(rupeesToPaise(15_000)).toBe("1500000")
    expect(rupeesToPaise(0.01)).toBe("1")
  })

  it("rounds to the nearest representable paise", () => {
    expect(rupeesToPaise(1.004)).toBe("100")
    expect(rupeesToPaise(1.006)).toBe("101")
  })

  it("resolves a decimal midpoint by its binary representation, which can go either way", () => {
    expect(rupeesToPaise(1.005)).toBe("100")
    expect(rupeesToPaise(2.675)).toBe("268")
  })

  it("survives binary floating point representation", () => {
    expect(rupeesToPaise(0.1 + 0.2)).toBe("30")
    expect(rupeesToPaise(1.1 * 3)).toBe("330")
  })

  it("refuses zero, negative and non-finite amounts", () => {
    for (const value of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rupeesToPaise(value), String(value)).toThrow(MoneyFormatError)
    }
  })

  it("refuses amounts outside the safe integer range", () => {
    expect(() => rupeesToPaise(Number.MAX_SAFE_INTEGER)).toThrow(MoneyFormatError)
  })
})

describe("round trip", () => {
  it("returns the original rupee amount for representable values", () => {
    for (const rupees of [1, 2, 99.99, 1234.56, 15_000]) {
      expect(paiseToRupees(rupeesToPaise(rupees)), String(rupees)).toBe(rupees)
    }
  })

  it("refuses to convert an amount that a number cannot hold without loss", () => {
    expect(() => paiseToRupees(toPaise("9007199254740993"))).toThrow(MoneyPrecisionError)
  })
})

describe("arithmetic uses bigint so large amounts do not drift", () => {
  it("adds and subtracts exactly", () => {
    expect(addPaise(toPaise("1"), toPaise("2"))).toBe("3")
    expect(addPaise(toPaise("9007199254740991"), toPaise("2"))).toBe("9007199254740993")
    expect(subtractPaise(toPaise("300"), toPaise("100"))).toBe("200")
    expect(subtractPaise(toPaise("100"), toPaise("300"))).toBe("-200")
  })

  it("compares without converting to number", () => {
    expect(comparePaise(toPaise("1"), toPaise("2"))).toBe(-1)
    expect(comparePaise(toPaise("2"), toPaise("2"))).toBe(0)
    expect(comparePaise(toPaise("3"), toPaise("2"))).toBe(1)
    expect(comparePaise(toPaise("9007199254740993"), toPaise("9007199254740992"))).toBe(1)
  })
})

describe("display formatting", () => {
  it("formats in Indian currency grouping", () => {
    expect(formatINR(toPaise("123845000"))).toBe("₹12,38,450")
  })

  it("shows decimals only when asked", () => {
    expect(formatINR(toPaise("12345"))).toBe("₹123")
    expect(formatINR(toPaise("12345"), { showDecimals: true })).toBe("₹123.45")
  })

  it("renders a negative amount with a single leading sign", () => {
    expect(formatINR(toPaise("-12345"), { showDecimals: true })).toBe("-₹123.45")
  })

  it("adds an explicit plus only when requested and positive", () => {
    expect(formatINR(toPaise("200"), { showSign: true })).toBe("+₹2")
    expect(formatINR(toPaise("-200"), { showSign: true })).toBe("-₹2")
    expect(formatINR(toPaise("0"), { showSign: true })).toBe("₹0")
  })
})
