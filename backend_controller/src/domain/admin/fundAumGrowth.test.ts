/**
 * Unit tests for the pure Fund AUM growth arithmetic (core mechanism spec
 * §8.3/§8.4/§8.5). Money is integer paise as `bigint`; percentage growth uses
 * the shared symmetric half-up basis-point rule, and a collective plan computes
 * every fund strictly from its own basis — no shared total is ever distributed.
 */
import { describe, expect, test } from "vitest"

import { AppError } from "../../http/errorCatalog.js"
import {
  assertAumDeltaNonZero,
  aumGrowthDelta,
  canonicalCollectiveAumCommand,
  computeAumBasisHash,
  planAumGrowth,
  type AumFundBasis,
} from "./fundAumGrowth.js"

const basis = (fundId: string, aumPaise: bigint, revision = 1): AumFundBasis => ({
  fundId,
  latestSnapshotId: `snap-${fundId}`,
  aumPaise,
  revision,
})

describe("aumGrowthDelta", () => {
  test("amount mode is the signed delta verbatim", () => {
    expect(aumGrowthDelta(1_000_000n, { kind: "amount", growthPaise: 250_000n })).toBe(250_000n)
    expect(aumGrowthDelta(1_000_000n, { kind: "amount", growthPaise: -400_000n })).toBe(-400_000n)
  })

  test("percentage mode applies the rate to the fund's own basis", () => {
    // +2.50% of 10,000,000 paise.
    expect(aumGrowthDelta(10_000_000n, { kind: "percentage", growthBasisPoints: 250n })).toBe(250_000n)
    // A different basis yields a different delta for the same rate.
    expect(aumGrowthDelta(3_000_000n, { kind: "percentage", growthBasisPoints: 250n })).toBe(75_000n)
  })

  test("percentage rounds symmetric half-up, losses included", () => {
    // 9,999 * 5 / 10,000 = 4.9995 -> 5
    expect(aumGrowthDelta(9_999n, { kind: "percentage", growthBasisPoints: 5n })).toBe(5n)
    // Loss rounds away from zero by the same magnitude.
    expect(aumGrowthDelta(9_999n, { kind: "percentage", growthBasisPoints: -5n })).toBe(-5n)
    // 1 * 50 / 10,000 = 0.005 -> 0 (below half a paise)
    expect(aumGrowthDelta(1n, { kind: "percentage", growthBasisPoints: 50n })).toBe(0n)
  })

  test("zero basis points yield a zero delta regardless of basis", () => {
    expect(aumGrowthDelta(123_456n, { kind: "percentage", growthBasisPoints: 0n })).toBe(0n)
  })
})

describe("planAumGrowth", () => {
  test("same-rate percentage computes each fund independently from its own basis", () => {
    const result = planAumGrowth(
      [basis("fund-a", 1_000_000n), basis("fund-b", 2_000_000n)],
      { type: "percentage", growthBasisPoints: 1000 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([
      {
        fundId: "fund-a",
        basisSnapshotId: "snap-fund-a",
        basisRevision: 1,
        beforeAumPaise: 1_000_000n,
        deltaPaise: 100_000n,
        afterAumPaise: 1_100_000n,
      },
      {
        fundId: "fund-b",
        basisSnapshotId: "snap-fund-b",
        basisRevision: 1,
        beforeAumPaise: 2_000_000n,
        deltaPaise: 200_000n,
        afterAumPaise: 2_200_000n,
      },
    ])
    expect(result.totalDeltaPaise).toBe(300_000n)
  })

  test("explicit deltas are preserved exactly and never averaged across funds", () => {
    const result = planAumGrowth(
      [basis("fund-a", 1_000_000n), basis("fund-b", 500n)],
      {
        type: "explicit_deltas",
        items: [
          { fundId: "fund-a", growthPaise: -999_999n },
          { fundId: "fund-b", growthPaise: 7n },
        ],
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items.map((item) => [item.fundId, item.deltaPaise, item.afterAumPaise])).toEqual([
      ["fund-a", -999_999n, 1n],
      ["fund-b", 7n, 507n],
    ])
    expect(result.totalDeltaPaise).toBe(-999_992n)
  })

  test("a negative result invalidates the whole plan and names the fund", () => {
    const result = planAumGrowth(
      [basis("fund-a", 1_000n), basis("fund-b", 2_000n)],
      { type: "percentage", growthBasisPoints: -10000 },
    )
    // -100% leaves exactly zero, which is allowed.
    expect(result.ok).toBe(true)

    const overflowing = planAumGrowth(
      [basis("fund-a", 1_000n), basis("fund-b", 2_000n)],
      {
        type: "explicit_deltas",
        items: [
          { fundId: "fund-a", growthPaise: 5n },
          { fundId: "fund-b", growthPaise: -2_001n },
        ],
      },
    )
    expect(overflowing.ok).toBe(false)
    if (overflowing.ok) return
    expect(overflowing.invalidFundIds).toEqual(["fund-b"])
  })

  test("a rate that rounds to a zero delta rejects the whole plan as a validation error", () => {
    let thrown: unknown
    try {
      planAumGrowth([basis("fund-a", 99n)], { type: "percentage", growthBasisPoints: 50 })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AppError)
    expect((thrown as AppError).code).toBe("VALIDATION_FAILED")
  })
})

describe("assertAumDeltaNonZero", () => {
  test("accepts any non-zero delta and rejects zero", () => {
    expect(() => assertAumDeltaNonZero(1n)).not.toThrow()
    expect(() => assertAumDeltaNonZero(-1n)).not.toThrow()

    let thrown: unknown
    try {
      assertAumDeltaNonZero(0n)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AppError)
    expect((thrown as AppError).code).toBe("VALIDATION_FAILED")
  })
})

describe("computeAumBasisHash", () => {
  const command = canonicalCollectiveAumCommand("2026-08-31", {
    type: "percentage",
    growthBasisPoints: 250,
  })

  test("is independent of the fund order in the input", () => {
    const first = computeAumBasisHash(command, [basis("fund-a", 100n), basis("fund-b", 200n)])
    const second = computeAumBasisHash(command, [basis("fund-b", 200n), basis("fund-a", 100n)])
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/u)
  })

  test("changes when any basis component changes (stale detection)", () => {
    const original = computeAumBasisHash(command, [basis("fund-a", 100n, 2)])
    expect(computeAumBasisHash(command, [basis("fund-a", 101n, 2)])).not.toBe(original)
    expect(computeAumBasisHash(command, [basis("fund-a", 100n, 3)])).not.toBe(original)
    expect(
      computeAumBasisHash(command, [{ ...basis("fund-a", 100n, 2), latestSnapshotId: "snap-other" }]),
    ).not.toBe(original)
    expect(computeAumBasisHash(command, [basis("fund-a", 100n, 2), basis("fund-b", 1n)])).not.toBe(original)
  })

  test("binds to the command: a different instruction or date hashes differently", () => {
    const bases = [basis("fund-a", 100n)]
    const other = canonicalCollectiveAumCommand("2026-08-31", {
      type: "percentage",
      growthBasisPoints: 251,
    })
    const otherDate = canonicalCollectiveAumCommand("2026-09-30", {
      type: "percentage",
      growthBasisPoints: 250,
    })
    expect(computeAumBasisHash(other, bases)).not.toBe(computeAumBasisHash(command, bases))
    expect(computeAumBasisHash(otherDate, bases)).not.toBe(computeAumBasisHash(command, bases))
  })
})

describe("canonicalCollectiveAumCommand", () => {
  test("sorts explicit deltas by fund id so input order cannot change the hash", () => {
    const first = canonicalCollectiveAumCommand("2026-08-31", {
      type: "explicit_deltas",
      items: [
        { fundId: "fund-b", growthPaise: 2n },
        { fundId: "fund-a", growthPaise: 1n },
      ],
    })
    const second = canonicalCollectiveAumCommand("2026-08-31", {
      type: "explicit_deltas",
      items: [
        { fundId: "fund-a", growthPaise: 1n },
        { fundId: "fund-b", growthPaise: 2n },
      ],
    })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    // Money serializes as decimal strings, never JS numbers.
    expect(JSON.stringify(first)).toContain('"growthPaise":"1"')
  })
})
