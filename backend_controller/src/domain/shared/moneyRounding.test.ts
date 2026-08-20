import { describe, expect, test } from "vitest"

import { symmetricHalfUpBasisPoints } from "./moneyRounding.js"

describe("symmetricHalfUpBasisPoints", () => {
  test("applies a gain rate to the basis", () => {
    // 3.50% of ₹1,00,000 = ₹3,500.
    expect(symmetricHalfUpBasisPoints(10_000_000n, 350n)).toBe(350_000n)
  })

  test("rounds half-up on an exact .5 paise", () => {
    // 100 * 55 = 5500 -> (5500 + 5000) / 10000 = 1.
    expect(symmetricHalfUpBasisPoints(100n, 55n)).toBe(1n)
    // 101 * 50 = 5050 -> 1; 99 * 50 = 4950 -> 0.
    expect(symmetricHalfUpBasisPoints(101n, 50n)).toBe(1n)
    expect(symmetricHalfUpBasisPoints(99n, 50n)).toBe(0n)
  })

  test("is symmetric for losses: the sign of the instruction decides direction", () => {
    expect(symmetricHalfUpBasisPoints(10_000_000n, -350n)).toBe(-350_000n)
    // A negative basis (reversal) with a negative rate still follows the rate's sign.
    expect(symmetricHalfUpBasisPoints(-100n, 55n)).toBe(1n)
    expect(symmetricHalfUpBasisPoints(-100n, -55n)).toBe(-1n)
  })

  test("zero basis points always yield zero", () => {
    expect(symmetricHalfUpBasisPoints(123_456_789n, 0n)).toBe(0n)
    expect(symmetricHalfUpBasisPoints(0n, 500n)).toBe(0n)
  })
})
