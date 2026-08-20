/**
 * Client growth domain rules (core mechanism spec §8.1/§8.2/§8.5).
 *
 * An admin adjusts client-displayed values by posting `growth_adjustment`
 * entries to the client value ledger, grouped under a `client_growth_batches`
 * header. This module is the pure computation half of that: signed delta
 * calculation (reusing the shared symmetric half-up basis-point rounding),
 * eligibility and preflight rules for collective batches, and the preview basis
 * hash a commit must reproduce.
 *
 * Boundary rules enforced by the architecture guard:
 *   - nothing here reads or writes fund AUM — client value only;
 *   - no proportional distribution of a shared currency total exists: a
 *     collective batch is either one rate applied independently per position or
 *     an explicit signed amount per named position, preserved exactly.
 */
import { createHash } from "node:crypto"

import { AppError } from "../../http/errorCatalog.js"
import { symmetricHalfUpBasisPoints } from "../shared/moneyRounding.js"

/** Lowest permitted signed rate: -10,000 bps = -100.00% (§8.1). */
export const MIN_GROWTH_BASIS_POINTS = -10_000

/** Largest collective batch; bigger requests are rejected, never chunked (§8.2). */
export const MAX_COLLECTIVE_CLIENT_TARGETS = 500

export type GrowthInstruction =
  | Readonly<{ kind: "amount"; growthPaise: bigint }>
  | Readonly<{ kind: "percentage"; growthBasisPoints: bigint }>

export type CollectiveGrowthInstruction =
  | Readonly<{ kind: "percentage"; growthBasisPoints: bigint }>
  | Readonly<{
      kind: "explicit_deltas"
      items: readonly Readonly<{ userId: string; growthPaise: bigint }>[]
    }>

/** One contribution-bearing ledger position: the basis a delta applies to. */
export interface ClientPositionBasis {
  readonly userId: string
  readonly currentValuePaise: bigint
  readonly latestEntryId: string | null
}

export interface PlannedGrowthTarget {
  readonly userId: string
  readonly beforePaise: bigint
  readonly deltaPaise: bigint
  readonly afterPaise: bigint
}

export interface CollectiveGrowthPlan {
  readonly instructionType: "percentage" | "explicit_deltas"
  /** Targets in deterministic (userId-sorted) order; doubles as lock order. */
  readonly targets: readonly PlannedGrowthTarget[]
  /** Contribution-bearing positions skipped because their value is not > 0. */
  readonly excludedCount: number
  readonly totalDeltaPaise: bigint
}

export interface CollectiveGrowthLimits {
  readonly maxTargets: number
  readonly maxBasisPoints: bigint
}

const byUserId = <T extends { readonly userId: string }>(left: T, right: T): number =>
  left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0

const assertBasisPointsInRange = (growthBasisPoints: bigint, maxBasisPoints: bigint): void => {
  if (
    growthBasisPoints === 0n ||
    growthBasisPoints < BigInt(MIN_GROWTH_BASIS_POINTS) ||
    growthBasisPoints > maxBasisPoints
  ) {
    throw new AppError("VALIDATION_FAILED", {
      fields: {
        growthBasisPoints: [
          `Must be a non-zero rate between ${MIN_GROWTH_BASIS_POINTS} and ${maxBasisPoints.toString()} basis points.`,
        ],
      },
    })
  }
}

const assertNonZeroAmount = (growthPaise: bigint): void => {
  if (growthPaise === 0n) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { growthPaise: ["Must be a non-zero signed paise amount."] },
    })
  }
}

const assertNonNegativeAfter = (afterPaise: bigint): void => {
  if (afterPaise < 0n) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { growth: ["The adjustment would make the client value negative."] },
    })
  }
}

/**
 * The signed value delta one growth instruction produces against a position
 * basis. Zero deltas are rejected: the ledger never stores zero rows.
 */
export const computeGrowthDelta = (
  basisPaise: bigint,
  instruction: GrowthInstruction,
  maxBasisPoints: bigint,
): bigint => {
  let delta: bigint
  if (instruction.kind === "amount") {
    assertNonZeroAmount(instruction.growthPaise)
    delta = instruction.growthPaise
  } else {
    assertBasisPointsInRange(instruction.growthBasisPoints, maxBasisPoints)
    delta = symmetricHalfUpBasisPoints(basisPaise, instruction.growthBasisPoints)
  }
  if (delta === 0n) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { growthBasisPoints: ["The rate rounds to a zero adjustment for this value."] },
    })
  }
  return delta
}

/** §8.1: one (userId, fundId) position; the principal delta is always zero. */
export const planIndividualGrowth = (
  currentValuePaise: bigint,
  instruction: GrowthInstruction,
  maxBasisPoints: bigint,
): Readonly<{ beforePaise: bigint; deltaPaise: bigint; afterPaise: bigint }> => {
  const deltaPaise = computeGrowthDelta(currentValuePaise, instruction, maxBasisPoints)
  const afterPaise = currentValuePaise + deltaPaise
  assertNonNegativeAfter(afterPaise)
  return { beforePaise: currentValuePaise, deltaPaise, afterPaise }
}

const NO_ELIGIBLE_POSITIONS = (): AppError =>
  new AppError("STATE_CONFLICT", {
    message: "The fund has no eligible client positions for a growth batch.",
  })

/**
 * §8.2: plan one collective batch within a single fund. `positions` is every
 * contribution-bearing position in the fund (the repository pre-filters to
 * unreversed rows); eligible positions are those with current value > 0.
 *
 * Any rule violation throws and produces no plan, so a commit that applies the
 * plan row-by-row is all-or-nothing by construction.
 */
export const planCollectiveClientGrowth = (
  positions: readonly ClientPositionBasis[],
  instruction: CollectiveGrowthInstruction,
  limits: CollectiveGrowthLimits,
): CollectiveGrowthPlan => {
  const eligible = positions.filter((p) => p.currentValuePaise > 0n)
  const excludedCount = positions.length - eligible.length

  if (instruction.kind === "percentage") {
    assertBasisPointsInRange(instruction.growthBasisPoints, limits.maxBasisPoints)
    if (eligible.length === 0) throw NO_ELIGIBLE_POSITIONS()
    if (eligible.length > limits.maxTargets) {
      throw new AppError("VALIDATION_FAILED", {
        fields: { fundId: [`The fund has more than ${limits.maxTargets} eligible positions.`] },
      })
    }
    const targets = eligible
      .map((p) => ({
        userId: p.userId,
        beforePaise: p.currentValuePaise,
        deltaPaise: symmetricHalfUpBasisPoints(p.currentValuePaise, instruction.growthBasisPoints),
      }))
      // A rate in [-100%, max] can never drive a positive basis negative, so
      // the only preflight here is dropping calculated zero deltas (§8.2).
      .filter((target) => target.deltaPaise !== 0n)
      .map((target) => ({ ...target, afterPaise: target.beforePaise + target.deltaPaise }))
      .sort(byUserId)
    if (targets.length === 0) throw NO_ELIGIBLE_POSITIONS()
    return {
      instructionType: "percentage",
      targets,
      excludedCount,
      totalDeltaPaise: targets.reduce((sum, target) => sum + target.deltaPaise, 0n),
    }
  }

  if (instruction.items.length === 0) {
    throw new AppError("VALIDATION_FAILED", { fields: { items: ["Must list at least one target."] } })
  }
  if (instruction.items.length > limits.maxTargets) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { items: [`Must list at most ${limits.maxTargets} targets.`] },
    })
  }
  const seen = new Set<string>()
  for (const item of instruction.items) {
    if (seen.has(item.userId)) {
      throw new AppError("VALIDATION_FAILED", {
        fields: { items: ["Each client may appear only once."] },
      })
    }
    seen.add(item.userId)
  }
  if (eligible.length === 0) throw NO_ELIGIBLE_POSITIONS()

  const byUser = new Map(eligible.map((p) => [p.userId, p]))
  const targets: PlannedGrowthTarget[] = instruction.items.map((item) => {
    assertNonZeroAmount(item.growthPaise)
    const position = byUser.get(item.userId)
    if (position === undefined) {
      throw new AppError("VALIDATION_FAILED", {
        fields: { items: ["Every target must be an eligible position in the selected fund."] },
      })
    }
    const afterPaise = position.currentValuePaise + item.growthPaise
    assertNonNegativeAfter(afterPaise)
    return {
      userId: item.userId,
      beforePaise: position.currentValuePaise,
      deltaPaise: item.growthPaise,
      afterPaise,
    }
  })
  targets.sort(byUserId)
  return {
    instructionType: "explicit_deltas",
    targets,
    excludedCount,
    totalDeltaPaise: targets.reduce((sum, target) => sum + target.deltaPaise, 0n),
  }
}

/**
 * §8.5 preview/commit hash. The input is the command identity, the fund, and
 * every contribution-bearing position's (userId, currentValue, latestEntryId)
 * sorted by userId — including zero-value positions, so a basis change
 * anywhere in the fund invalidates the preview.
 */
export const computeClientGrowthBasisHash = (
  command: string,
  fundId: string,
  positions: readonly ClientPositionBasis[],
): string => {
  const sorted = [...positions].sort(byUserId)
  return createHash("sha256")
    .update(
      JSON.stringify({
        command,
        fundId,
        positions: sorted.map((p) => [p.userId, p.currentValuePaise.toString(), p.latestEntryId]),
      }),
    )
    .digest("hex")
}
