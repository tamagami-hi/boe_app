import { describe, expect, test } from "vitest"

import {
  splitPoolGainByAmount,
  splitPoolGainByPercent,
  type PoolMember,
} from "./poolGainDistribution.js"

const member = (userId: string, rupees: number): PoolMember => ({
  userId,
  currentValuePaise: BigInt(Math.round(rupees * 100)),
})

const sum = (values: readonly bigint[]): bigint => values.reduce((total, value) => total + value, 0n)

describe("splitPoolGainByAmount", () => {
  test("splits in proportion to each investor's value", () => {
    // ₹6,00,000 and ₹4,00,000 in the pool; ₹1,00,000 of growth splits 60/40.
    const result = splitPoolGainByAmount([member("a", 600_000), member("b", 400_000)], 10_000_000n)
    expect(result.shares.map((share) => share.gainPaise)).toEqual([6_000_000n, 4_000_000n])
    expect(result.allocatedPaise).toBe(10_000_000n)
    expect(result.basisPaise).toBe(100_000_000n)
  })

  test("allocates every paisa when the split does not divide evenly", () => {
    // Three equal holdings and 100 paise: 33/33/33 leaves 1 paisa to place.
    const members = [member("a", 1000), member("b", 1000), member("c", 1000)]
    const result = splitPoolGainByAmount(members, 100n)
    expect(sum(result.shares.map((share) => share.gainPaise))).toBe(100n)
    expect(result.allocatedPaise).toBe(100n)
    // The extra paisa goes to exactly one investor.
    expect(result.shares.filter((share) => share.gainPaise === 34n)).toHaveLength(1)
  })

  test("is independent of member order", () => {
    const members = [member("a", 1234.56), member("b", 7654.32), member("c", 99.99)]
    const forward = splitPoolGainByAmount(members, 123_457n)
    const reversed = splitPoolGainByAmount([...members].reverse(), 123_457n)
    const byUser = (result: typeof forward) =>
      Object.fromEntries(result.shares.map((share) => [share.userId, share.gainPaise]))
    expect(byUser(forward)).toEqual(byUser(reversed))
    expect(forward.allocatedPaise).toBe(123_457n)
  })

  test("a loss distributes the same way and never exceeds a holding", () => {
    const members = [member("a", 1000), member("b", 9000)]
    const result = splitPoolGainByAmount(members, -50_000n)
    expect(result.allocatedPaise).toBe(-50_000n)
    for (const share of result.shares) {
      expect(share.gainPaise).toBeLessThanOrEqual(0n)
      // The share cannot drive the investor below zero.
      expect(share.currentValuePaise + share.gainPaise).toBeGreaterThanOrEqual(0n)
    }
  })

  test("an investor with no value receives nothing", () => {
    const result = splitPoolGainByAmount([member("a", 0), member("b", 5000)], 999n)
    expect(result.shares[0]?.gainPaise).toBe(0n)
    expect(result.shares[1]?.gainPaise).toBe(999n)
  })

  test("an empty pool or a zero total allocates nothing", () => {
    expect(splitPoolGainByAmount([], 100n).allocatedPaise).toBe(0n)
    expect(splitPoolGainByAmount([member("a", 0)], 100n).allocatedPaise).toBe(0n)
    expect(splitPoolGainByAmount([member("a", 100)], 0n).allocatedPaise).toBe(0n)
  })

  test("the sum is exact across many uneven holdings", () => {
    const members = Array.from({ length: 37 }, (_unused, index) =>
      member(`u${String(index).padStart(2, "0")}`, 1000 + index * 137.77),
    )
    for (const total of [1n, 7n, 999n, 1_000_001n, 123_456_789n]) {
      const result = splitPoolGainByAmount(members, total)
      expect(sum(result.shares.map((share) => share.gainPaise))).toBe(total)
    }
  })
})

describe("splitPoolGainByPercent", () => {
  test("gives each investor that percentage of their own value", () => {
    // 3.5% on ₹10,00,000 and ₹5,00,000.
    const result = splitPoolGainByPercent([member("a", 1_000_000), member("b", 500_000)], 350)
    expect(result.shares.map((share) => share.gainPaise)).toEqual([3_500_000n, 1_750_000n])
    expect(result.allocatedPaise).toBe(5_250_000n)
  })

  test("reproduces the model document's pool growth", () => {
    // ₹10.00 Cr growing 3.5% adds ₹0.35 Cr, taking the pool to ₹10.35 Cr.
    const result = splitPoolGainByPercent([member("a", 100_000_000)], 350)
    expect(result.allocatedPaise).toBe(350_000_000n)
    expect(result.basisPaise + result.allocatedPaise).toBe(10_350_000_000n)
  })

  test("rounds half-up per investor so a small holding is not zeroed", () => {
    // ₹1.00 at 3.5% is 3.5 paise -> 4 paise.
    const result = splitPoolGainByPercent([member("a", 1)], 350)
    expect(result.shares[0]?.gainPaise).toBe(4n)
  })

  test("a negative percentage is a loss bounded by the holding", () => {
    const result = splitPoolGainByPercent([member("a", 1000), member("b", 250.5)], -1000)
    expect(result.allocatedPaise).toBeLessThan(0n)
    for (const share of result.shares) {
      expect(share.currentValuePaise + share.gainPaise).toBeGreaterThanOrEqual(0n)
    }
  })

  test("zero percent allocates nothing", () => {
    expect(splitPoolGainByPercent([member("a", 1000)], 0).allocatedPaise).toBe(0n)
  })
})
