/**
 * Client growth domain rules (core mechanism spec §8.1/§8.2/§8.5, §14 "Client
 * growth"). Pure computation: signed deltas, symmetric half-up rounding reuse,
 * eligibility, collective planning, and the preview basis hash. PostgreSQL-bound
 * behavior is covered by test/integration/clientGrowth.integration.test.ts.
 */
import { describe, expect, test } from "vitest"

import { AppError } from "../../http/errorCatalog.js"
import {
  computeClientGrowthBasisHash,
  MAX_COLLECTIVE_CLIENT_TARGETS,
  MIN_GROWTH_BASIS_POINTS,
  planCollectiveClientGrowth,
  planIndividualGrowth,
  type ClientPositionBasis,
} from "./clientGrowth.js"

const MAX_BASIS_POINTS = 100_000n
const LIMITS = { maxTargets: MAX_COLLECTIVE_CLIENT_TARGETS, maxBasisPoints: MAX_BASIS_POINTS } as const

const position = (
  userId: string,
  currentValuePaise: bigint,
  latestEntryId: string | null = `entry-${userId}`,
): ClientPositionBasis => ({ userId, currentValuePaise, latestEntryId })

const expectAppError = (run: () => unknown, code: string): AppError => {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return error as AppError
  }
  throw new Error("expected an AppError")
}

describe("planIndividualGrowth (§8.1)", () => {
  test("amount mode applies the signed delta unchanged", () => {
    expect(
      planIndividualGrowth(1_000_000n, { kind: "amount", growthPaise: 25_000n }, MAX_BASIS_POINTS),
    ).toEqual({ beforePaise: 1_000_000n, deltaPaise: 25_000n, afterPaise: 1_025_000n })
    expect(
      planIndividualGrowth(1_000_000n, { kind: "amount", growthPaise: -25_000n }, MAX_BASIS_POINTS),
    ).toEqual({ beforePaise: 1_000_000n, deltaPaise: -25_000n, afterPaise: 975_000n })
  })

  test("percentage mode rounds symmetric half-up on the magnitude", () => {
    // 1,000,000 * 250 / 10,000 = 25,000 exactly.
    expect(
      planIndividualGrowth(1_000_000n, { kind: "percentage", growthBasisPoints: 250n }, MAX_BASIS_POINTS)
        .deltaPaise,
    ).toBe(25_000n)
    // 9,999 * 1 / 10,000 = 0.9999 -> 1 (half-up on magnitude).
    expect(
      planIndividualGrowth(9_999n, { kind: "percentage", growthBasisPoints: 1n }, MAX_BASIS_POINTS).deltaPaise,
    ).toBe(1n)
    // A loss rounds away from zero exactly as a gain does: -0.9999 -> -1.
    expect(
      planIndividualGrowth(9_999n, { kind: "percentage", growthBasisPoints: -1n }, MAX_BASIS_POINTS).deltaPaise,
    ).toBe(-1n)
    // -100.00% is the lowest permitted rate and zeroes the position exactly.
    expect(
      planIndividualGrowth(
        1_000_000n,
        { kind: "percentage", growthBasisPoints: BigInt(MIN_GROWTH_BASIS_POINTS) },
        MAX_BASIS_POINTS,
      ),
    ).toEqual({ beforePaise: 1_000_000n, deltaPaise: -1_000_000n, afterPaise: 0n })
  })

  test("rejects a zero amount, zero rate, and a rate outside the configured band", () => {
    expectAppError(
      () => planIndividualGrowth(1_000_000n, { kind: "amount", growthPaise: 0n }, MAX_BASIS_POINTS),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () => planIndividualGrowth(1_000_000n, { kind: "percentage", growthBasisPoints: 0n }, MAX_BASIS_POINTS),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () =>
        planIndividualGrowth(
          1_000_000n,
          { kind: "percentage", growthBasisPoints: BigInt(MIN_GROWTH_BASIS_POINTS - 1) },
          MAX_BASIS_POINTS,
        ),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () =>
        planIndividualGrowth(
          1_000_000n,
          { kind: "percentage", growthBasisPoints: MAX_BASIS_POINTS + 1n },
          MAX_BASIS_POINTS,
        ),
      "VALIDATION_FAILED",
    )
  })

  test("rejects a percentage delta that rounds to zero", () => {
    // 4 * 1 / 10,000 = 0.0004 -> 0: no zero ledger rows (§8.2).
    expectAppError(
      () => planIndividualGrowth(4n, { kind: "percentage", growthBasisPoints: 1n }, MAX_BASIS_POINTS),
      "VALIDATION_FAILED",
    )
  })

  test("a loss cannot make the after-value negative; exactly zero is allowed", () => {
    expectAppError(
      () => planIndividualGrowth(1_000_000n, { kind: "amount", growthPaise: -1_000_001n }, MAX_BASIS_POINTS),
      "VALIDATION_FAILED",
    )
    expect(
      planIndividualGrowth(1_000n, { kind: "amount", growthPaise: -1_000n }, MAX_BASIS_POINTS).afterPaise,
    ).toBe(0n)
  })
})

describe("planCollectiveClientGrowth (§8.2)", () => {
  test("percentage mode calculates every eligible position independently", () => {
    const plan = planCollectiveClientGrowth(
      [position("user-a", 1_000_000n), position("user-b", 500_000n)],
      { kind: "percentage", growthBasisPoints: 250n },
      LIMITS,
    )
    expect(plan.instructionType).toBe("percentage")
    expect(plan.targets).toEqual([
      { userId: "user-a", beforePaise: 1_000_000n, deltaPaise: 25_000n, afterPaise: 1_025_000n },
      { userId: "user-b", beforePaise: 500_000n, deltaPaise: 12_500n, afterPaise: 512_500n },
    ])
    expect(plan.totalDeltaPaise).toBe(37_500n)
    expect(plan.excludedCount).toBe(0)
  })

  test("percentage mode skips calculated zero deltas instead of planning zero rows", () => {
    const plan = planCollectiveClientGrowth(
      [position("user-a", 1_000_000n), position("user-tiny", 4n)],
      { kind: "percentage", growthBasisPoints: 100n },
      LIMITS,
    )
    expect(plan.targets.map((target) => target.userId)).toEqual(["user-a"])
    // The tiny position was eligible (value > 0), so it is not "excluded".
    expect(plan.excludedCount).toBe(0)
  })

  test("a percentage batch whose deltas all round to zero has nothing to commit", () => {
    const error = expectAppError(
      () =>
        planCollectiveClientGrowth(
          [position("user-tiny", 4n)],
          { kind: "percentage", growthBasisPoints: 1n },
          LIMITS,
        ),
      "STATE_CONFLICT",
    )
    expect(error.httpStatus).toBe(409)
  })

  test("explicit deltas are preserved exactly and the batch total is their sum", () => {
    const plan = planCollectiveClientGrowth(
      [position("user-a", 1_000_000n), position("user-b", 500_000n)],
      {
        kind: "explicit_deltas",
        items: [
          { userId: "user-b", growthPaise: -456n },
          { userId: "user-a", growthPaise: 123n },
        ],
      },
      LIMITS,
    )
    expect(plan.instructionType).toBe("explicit_deltas")
    // Targets come back in deterministic (sorted) order; amounts are untouched.
    expect(plan.targets).toEqual([
      { userId: "user-a", beforePaise: 1_000_000n, deltaPaise: 123n, afterPaise: 1_000_123n },
      { userId: "user-b", beforePaise: 500_000n, deltaPaise: -456n, afterPaise: 499_544n },
    ])
    expect(plan.totalDeltaPaise).toBe(-333n)
  })

  test("zero-value positions are excluded and reported", () => {
    const plan = planCollectiveClientGrowth(
      [position("user-a", 1_000_000n), position("user-empty", 0n)],
      { kind: "percentage", growthBasisPoints: 250n },
      LIMITS,
    )
    expect(plan.targets.map((target) => target.userId)).toEqual(["user-a"])
    expect(plan.excludedCount).toBe(1)
  })

  test("a batch with no eligible positions is a 409 conflict", () => {
    const error = expectAppError(
      () =>
        planCollectiveClientGrowth(
          [position("user-empty", 0n)],
          { kind: "percentage", growthBasisPoints: 250n },
          LIMITS,
        ),
      "STATE_CONFLICT",
    )
    expect(error.httpStatus).toBe(409)
    expectAppError(
      () =>
        planCollectiveClientGrowth(
          [],
          { kind: "explicit_deltas", items: [{ userId: "user-a", growthPaise: 100n }] },
          LIMITS,
        ),
      "STATE_CONFLICT",
    )
  })

  test("one invalid explicit target rejects the entire batch", () => {
    // user-b would go negative; user-a alone was valid — no partial plan.
    expectAppError(
      () =>
        planCollectiveClientGrowth(
          [position("user-a", 1_000_000n), position("user-b", 500_000n)],
          {
            kind: "explicit_deltas",
            items: [
              { userId: "user-a", growthPaise: 100n },
              { userId: "user-b", growthPaise: -500_001n },
            ],
          },
          LIMITS,
        ),
      "VALIDATION_FAILED",
    )
  })

  test("explicit items cannot target unknown, zero-value, or duplicated positions", () => {
    const positions = [position("user-a", 1_000_000n), position("user-empty", 0n)]
    expectAppError(
      () =>
        planCollectiveClientGrowth(
          positions,
          { kind: "explicit_deltas", items: [{ userId: "user-unknown", growthPaise: 100n }] },
          LIMITS,
        ),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () =>
        planCollectiveClientGrowth(
          positions,
          { kind: "explicit_deltas", items: [{ userId: "user-empty", growthPaise: 100n }] },
          LIMITS,
        ),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () =>
        planCollectiveClientGrowth(
          positions,
          {
            kind: "explicit_deltas",
            items: [
              { userId: "user-a", growthPaise: 100n },
              { userId: "user-a", growthPaise: 200n },
            ],
          },
          LIMITS,
        ),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () =>
        planCollectiveClientGrowth(
          positions,
          { kind: "explicit_deltas", items: [{ userId: "user-a", growthPaise: 0n }] },
          LIMITS,
        ),
      "VALIDATION_FAILED",
    )
  })

  test("rejects batches above the position cap instead of chunking them", () => {
    const positions = Array.from({ length: MAX_COLLECTIVE_CLIENT_TARGETS + 1 }, (_, index) =>
      position(`user-${String(index).padStart(4, "0")}`, 1_000_000n),
    )
    expectAppError(
      () => planCollectiveClientGrowth(positions, { kind: "percentage", growthBasisPoints: 250n }, LIMITS),
      "VALIDATION_FAILED",
    )
    const items = positions.map((p) => ({ userId: p.userId, growthPaise: 100n }))
    expectAppError(
      () => planCollectiveClientGrowth(positions, { kind: "explicit_deltas", items }, LIMITS),
      "VALIDATION_FAILED",
    )
  })

  test("a percentage loss is preflighted so no target becomes negative", () => {
    // -100% exactly zeroes every position; that is the permitted floor.
    const plan = planCollectiveClientGrowth(
      [position("user-a", 1_000_000n), position("user-b", 500_000n)],
      { kind: "percentage", growthBasisPoints: -10_000n },
      LIMITS,
    )
    expect(plan.targets.every((target) => target.afterPaise === 0n)).toBe(true)
    expect(plan.totalDeltaPaise).toBe(-1_500_000n)
  })
})

describe("computeClientGrowthBasisHash (§8.5)", () => {
  const positions = [position("user-b", 500_000n), position("user-a", 1_000_000n)]

  test("is deterministic and independent of input order", () => {
    const first = computeClientGrowthBasisHash("client-growth.collective.percentage", "fund-1", positions)
    const second = computeClientGrowthBasisHash("client-growth.collective.percentage", "fund-1", [
      positions[1]!,
      positions[0]!,
    ])
    expect(first).toMatch(/^[0-9a-f]{64}$/u)
    expect(second).toBe(first)
  })

  test("changes when any basis component changes", () => {
    const base = computeClientGrowthBasisHash("client-growth.collective.percentage", "fund-1", positions)
    const changedValue = computeClientGrowthBasisHash("client-growth.collective.percentage", "fund-1", [
      position("user-a", 1_000_001n),
      position("user-b", 500_000n),
    ])
    const changedEntry = computeClientGrowthBasisHash("client-growth.collective.percentage", "fund-1", [
      position("user-a", 1_000_000n, "entry-new"),
      position("user-b", 500_000n),
    ])
    const changedCommand = computeClientGrowthBasisHash(
      "client-growth.collective.explicit_deltas",
      "fund-1",
      positions,
    )
    const changedFund = computeClientGrowthBasisHash("client-growth.collective.percentage", "fund-2", positions)
    for (const other of [changedValue, changedEntry, changedCommand, changedFund]) {
      expect(other).not.toBe(base)
    }
  })
})
