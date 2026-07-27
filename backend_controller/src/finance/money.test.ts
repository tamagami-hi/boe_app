import { describe, expect, test } from "vitest"

import {
  computeAllotmentUnits,
  formatScaled,
  parseDecimalToScaled,
  roundHalfEvenDiv,
} from "./money.js"

describe("parseDecimalToScaled", () => {
  test("parses integer and fractional NAV text to scale-8 integers", () => {
    expect(parseDecimalToScaled("20.00000000", 8)).toBe(2_000_000_000n)
    expect(parseDecimalToScaled("20", 8)).toBe(2_000_000_000n)
    expect(parseDecimalToScaled("12.34560000", 8)).toBe(1_234_560_000n)
    expect(parseDecimalToScaled("0.00000001", 8)).toBe(1n)
  })

  test("rejects malformed input and excess precision", () => {
    expect(() => parseDecimalToScaled("abc", 8)).toThrow(RangeError)
    expect(() => parseDecimalToScaled("1.234567890", 8)).toThrow(RangeError)
    expect(() => parseDecimalToScaled("-5.0", 8)).toThrow(RangeError)
  })
})

describe("roundHalfEvenDiv (banker's rounding)", () => {
  test("exact division has no rounding", () => {
    expect(roundHalfEvenDiv(10n, 2n)).toBe(5n)
    expect(roundHalfEvenDiv(0n, 7n)).toBe(0n)
  })

  test("rounds to the even neighbour on an exact half", () => {
    expect(roundHalfEvenDiv(1n, 2n)).toBe(0n) // 0.5 -> 0 (even)
    expect(roundHalfEvenDiv(3n, 2n)).toBe(2n) // 1.5 -> 2 (even)
    expect(roundHalfEvenDiv(5n, 2n)).toBe(2n) // 2.5 -> 2 (even)
    expect(roundHalfEvenDiv(7n, 2n)).toBe(4n) // 3.5 -> 4 (even)
    expect(roundHalfEvenDiv(9n, 2n)).toBe(4n) // 4.5 -> 4 (even)
  })

  test("rounds normally when not exactly halfway", () => {
    expect(roundHalfEvenDiv(10n, 3n)).toBe(3n) // 3.33 -> 3
    expect(roundHalfEvenDiv(11n, 3n)).toBe(4n) // 3.67 -> 4
    expect(roundHalfEvenDiv(100n, 3n)).toBe(33n) // 33.33 -> 33
  })

  test("handles negative numerators symmetrically", () => {
    expect(roundHalfEvenDiv(-1n, 2n)).toBe(0n) // -0.5 -> 0 (even)
    expect(roundHalfEvenDiv(-3n, 2n)).toBe(-2n) // -1.5 -> -2 (even)
    expect(roundHalfEvenDiv(-11n, 3n)).toBe(-4n) // -3.67 -> -4
  })

  test("rejects division by zero", () => {
    expect(() => roundHalfEvenDiv(1n, 0n)).toThrow(RangeError)
  })
})

describe("formatScaled", () => {
  test("renders scaled integers as fixed-scale decimals", () => {
    expect(formatScaled(5_000_000_000n, 8)).toBe("50.00000000")
    expect(formatScaled(1n, 8)).toBe("0.00000001")
    expect(formatScaled(0n, 8)).toBe("0.00000000")
    expect(formatScaled(33_333_333n, 8)).toBe("0.33333333")
  })
})

describe("computeAllotmentUnits (spec 03 §4.3)", () => {
  test("exact whole-unit allotment", () => {
    // ₹1,000 (100000 paise) at NAV 20.00 => 50 units.
    expect(computeAllotmentUnits(100_000n, "20.00000000")).toBe("50.00000000")
  })

  test("repeating decimal is truncated to scale 8 (half-even)", () => {
    // ₹1 (100 paise) at NAV 3.00 => 0.33333333 (remainder < half).
    expect(computeAllotmentUnits(100n, "3.00000000")).toBe("0.33333333")
  })

  test("fractional NAV that divides evenly", () => {
    // ₹1,500 (150000 paise) at NAV 12.50 => 1500 / 12.5 = 120 units exactly.
    expect(computeAllotmentUnits(150_000n, "12.50000000")).toBe("120.00000000")
  })

  test("sub-rupee amount still allots exact units", () => {
    // 1 paise at NAV 0.00000001 => (1 * 1e14) / 1 = 1e14 scaled8 => 1,000,000 units.
    expect(computeAllotmentUnits(1n, "0.00000001")).toBe("1000000.00000000")
  })

  test("rejects non-positive amount or NAV", () => {
    expect(() => computeAllotmentUnits(0n, "20.00000000")).toThrow(RangeError)
    expect(() => computeAllotmentUnits(100n, "0.00000000")).toThrow(RangeError)
  })

  test("never uses floating point: a NAV that breaks Number precision is exact", () => {
    // NAV 1.00000003 with a large amount, verified against an independent BigInt
    // reimplementation of units = round_half_even(amount_paise * 1e14 / navScaled8).
    const amountPaise = 999_999_999n
    const navScaled8 = 100_000_003n
    const num = amountPaise * 10n ** 14n
    const q = num / navScaled8
    const r = num - q * navScaled8
    const rounded = 2n * r < navScaled8 ? q : 2n * r > navScaled8 ? q + 1n : q % 2n === 0n ? q : q + 1n
    const expected = `${(rounded / 10n ** 8n).toString()}.${(rounded % 10n ** 8n).toString().padStart(8, "0")}`
    expect(computeAllotmentUnits(amountPaise, "1.00000003")).toBe(expected)
  })
})
