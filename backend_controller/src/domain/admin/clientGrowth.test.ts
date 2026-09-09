import { describe, expect, test } from "vitest"

import { AppError } from "../../http/errorCatalog.js"
import {
  computeClientGrowthBasisHash,
  MAX_COLLECTIVE_CLIENT_TARGETS,
  MAX_GROWTH_BASIS_POINTS,
  MIN_GROWTH_BASIS_POINTS,
  planCollectiveClientGrowth,
  planIndividualGrowth,
  type ClientPositionBasis,
} from "./clientGrowth.js"

const LIMITS = { maxTargets: MAX_COLLECTIVE_CLIENT_TARGETS } as const

const position = (
  userId: string,
  principalPaise: bigint,
  currentValuePaise: bigint,
  latestEntryId: string | null = `entry-${userId}`,
): ClientPositionBasis => ({ userId, principalPaise, currentValuePaise, latestEntryId })

const basis = (principalPaise: bigint, currentValuePaise: bigint) => ({
  principalPaise,
  currentValuePaise,
})

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
  test("amount mode applies the signed delta unchanged and ignores principal", () => {
    expect(
      planIndividualGrowth(basis(1_000_000n, 1_500_000n), { kind: "amount", growthPaise: 25_000n }),
    ).toEqual({
      principalPaise: 1_000_000n,
      beforePaise: 1_500_000n,
      deltaPaise: 25_000n,
      afterPaise: 1_525_000n,
    })
    expect(
      planIndividualGrowth(basis(1_000_000n, 1_500_000n), { kind: "amount", growthPaise: -25_000n })
        .afterPaise,
    ).toBe(1_475_000n)
  })

  test("a percentage is measured against principal, not current value", () => {
    expect(
      planIndividualGrowth(basis(1_000_000n, 1_150_000n), {
        kind: "percentage",
        growthBasisPoints: 500n,
      }),
    ).toEqual({
      principalPaise: 1_000_000n,
      beforePaise: 1_150_000n,
      deltaPaise: 50_000n,
      afterPaise: 1_200_000n,
    })
    expect(
      planIndividualGrowth(basis(1_000_000n, 1_500_000n), {
        kind: "percentage",
        growthBasisPoints: 1_000n,
      }).deltaPaise,
    ).toBe(100_000n)
  })

  test("the same rate applied again yields the same delta: growth does not compound", () => {
    const first = planIndividualGrowth(basis(1_000_000n, 1_150_000n), {
      kind: "percentage",
      growthBasisPoints: 500n,
    })
    const second = planIndividualGrowth(basis(1_000_000n, first.afterPaise), {
      kind: "percentage",
      growthBasisPoints: 500n,
    })
    expect(first.deltaPaise).toBe(50_000n)
    expect(second.deltaPaise).toBe(50_000n)
    expect(second.afterPaise).toBe(1_250_000n)
  })

  test("percentage mode rounds symmetric half-up on the magnitude", () => {
    expect(
      planIndividualGrowth(basis(9_999n, 9_999n), { kind: "percentage", growthBasisPoints: 1n })
        .deltaPaise,
    ).toBe(1n)
    expect(
      planIndividualGrowth(basis(9_999n, 9_999n), { kind: "percentage", growthBasisPoints: -1n })
        .deltaPaise,
    ).toBe(-1n)
  })

  test("rejects a zero amount, zero rate, and a rate outside the ±2000 bp band", () => {
    expectAppError(
      () => planIndividualGrowth(basis(1_000_000n, 1_000_000n), { kind: "amount", growthPaise: 0n }),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () =>
        planIndividualGrowth(basis(1_000_000n, 1_000_000n), {
          kind: "percentage",
          growthBasisPoints: 0n,
        }),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () =>
        planIndividualGrowth(basis(1_000_000n, 1_000_000n), {
          kind: "percentage",
          growthBasisPoints: BigInt(MIN_GROWTH_BASIS_POINTS - 1),
        }),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () =>
        planIndividualGrowth(basis(1_000_000n, 1_000_000n), {
          kind: "percentage",
          growthBasisPoints: BigInt(MAX_GROWTH_BASIS_POINTS + 1),
        }),
      "VALIDATION_FAILED",
    )
    expect(
      planIndividualGrowth(basis(1_000_000n, 1_000_000n), {
        kind: "percentage",
        growthBasisPoints: BigInt(MAX_GROWTH_BASIS_POINTS),
      }).deltaPaise,
    ).toBe(200_000n)
  })

  test("rejects a percentage against a position with no principal", () => {
    expectAppError(
      () =>
        planIndividualGrowth(basis(0n, 500_000n), { kind: "percentage", growthBasisPoints: 500n }),
      "VALIDATION_FAILED",
    )
  })

  test("rejects a percentage delta that rounds to zero", () => {
    expectAppError(
      () => planIndividualGrowth(basis(4n, 4n), { kind: "percentage", growthBasisPoints: 1n }),
      "VALIDATION_FAILED",
    )
  })

  test("a loss cannot make the after-value negative; exactly zero is allowed", () => {
    expectAppError(
      () =>
        planIndividualGrowth(basis(1_000_000n, 1_000_000n), {
          kind: "amount",
          growthPaise: -1_000_001n,
        }),
      "VALIDATION_FAILED",
    )
    expect(
      planIndividualGrowth(basis(1_000n, 1_000n), { kind: "amount", growthPaise: -1_000n })
        .afterPaise,
    ).toBe(0n)
  })

  test("a principal-based loss larger than the current value is refused", () => {
    expectAppError(
      () =>
        planIndividualGrowth(basis(1_000_000n, 100_000n), {
          kind: "percentage",
          growthBasisPoints: -2_000n,
        }),
      "VALIDATION_FAILED",
    )
  })
})

describe("planCollectiveClientGrowth (§8.2)", () => {
  test("percentage mode measures each position against its own principal", () => {
    const plan = planCollectiveClientGrowth(
      [position("user-a", 1_000_000n, 1_500_000n), position("user-b", 500_000n, 500_000n)],
      { kind: "percentage", growthBasisPoints: 250n },
      LIMITS,
    )
    expect(plan.instructionType).toBe("percentage")
    expect(plan.targets).toEqual([
      {
        userId: "user-a",
        principalPaise: 1_000_000n,
        beforePaise: 1_500_000n,
        deltaPaise: 25_000n,
        afterPaise: 1_525_000n,
      },
      {
        userId: "user-b",
        principalPaise: 500_000n,
        beforePaise: 500_000n,
        deltaPaise: 12_500n,
        afterPaise: 512_500n,
      },
    ])
    expect(plan.totalDeltaPaise).toBe(37_500n)
    expect(plan.excludedCount).toBe(0)
  })

  test("percentage mode skips calculated zero deltas instead of planning zero rows", () => {
    const plan = planCollectiveClientGrowth(
      [position("user-a", 1_000_000n, 1_000_000n), position("user-tiny", 4n, 4n)],
      { kind: "percentage", growthBasisPoints: 100n },
      LIMITS,
    )
    expect(plan.targets.map((target) => target.userId)).toEqual(["user-a"])
    expect(plan.excludedCount).toBe(0)
  })

  test("a percentage batch whose deltas all round to zero has nothing to commit", () => {
    const error = expectAppError(
      () =>
        planCollectiveClientGrowth(
          [position("user-tiny", 4n, 4n)],
          { kind: "percentage", growthBasisPoints: 1n },
          LIMITS,
        ),
      "STATE_CONFLICT",
    )
    expect(error.httpStatus).toBe(409)
  })

  test("a percentage loss that would take any position below zero rejects the batch", () => {
    expectAppError(
      () =>
        planCollectiveClientGrowth(
          [position("user-a", 1_000_000n, 1_000_000n), position("user-b", 1_000_000n, 100_000n)],
          { kind: "percentage", growthBasisPoints: -2_000n },
          LIMITS,
        ),
      "VALIDATION_FAILED",
    )
  })

  test("explicit deltas are preserved exactly and the batch total is their sum", () => {
    const plan = planCollectiveClientGrowth(
      [position("user-a", 900_000n, 1_000_000n), position("user-b", 400_000n, 500_000n)],
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
    expect(plan.targets).toEqual([
      {
        userId: "user-a",
        principalPaise: 900_000n,
        beforePaise: 1_000_000n,
        deltaPaise: 123n,
        afterPaise: 1_000_123n,
      },
      {
        userId: "user-b",
        principalPaise: 400_000n,
        beforePaise: 500_000n,
        deltaPaise: -456n,
        afterPaise: 499_544n,
      },
    ])
    expect(plan.totalDeltaPaise).toBe(-333n)
  })

  test("zero-value positions are excluded and reported", () => {
    const plan = planCollectiveClientGrowth(
      [position("user-a", 1_000_000n, 1_000_000n), position("user-empty", 1_000_000n, 0n)],
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
          [position("user-empty", 1_000_000n, 0n)],
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
    expectAppError(
      () =>
        planCollectiveClientGrowth(
          [position("user-a", 1_000_000n, 1_000_000n), position("user-b", 500_000n, 500_000n)],
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
    const positions = [
      position("user-a", 1_000_000n, 1_000_000n),
      position("user-empty", 1_000_000n, 0n),
    ]
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
      position(`user-${String(index).padStart(4, "0")}`, 1_000_000n, 1_000_000n),
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
})

describe("computeClientGrowthBasisHash (§8.5)", () => {
  const positions = [
    position("user-b", 400_000n, 500_000n),
    position("user-a", 900_000n, 1_000_000n),
  ]

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
      position("user-a", 900_000n, 1_000_001n),
      position("user-b", 400_000n, 500_000n),
    ])
    const changedPrincipal = computeClientGrowthBasisHash(
      "client-growth.collective.percentage",
      "fund-1",
      [position("user-a", 900_001n, 1_000_000n), position("user-b", 400_000n, 500_000n)],
    )
    const changedEntry = computeClientGrowthBasisHash("client-growth.collective.percentage", "fund-1", [
      position("user-a", 900_000n, 1_000_000n, "entry-new"),
      position("user-b", 400_000n, 500_000n),
    ])
    const changedCommand = computeClientGrowthBasisHash(
      "client-growth.collective.explicit_deltas",
      "fund-1",
      positions,
    )
    const changedFund = computeClientGrowthBasisHash("client-growth.collective.percentage", "fund-2", positions)
    for (const other of [
      changedValue,
      changedPrincipal,
      changedEntry,
      changedCommand,
      changedFund,
    ]) {
      expect(other).not.toBe(base)
    }
  })
})
