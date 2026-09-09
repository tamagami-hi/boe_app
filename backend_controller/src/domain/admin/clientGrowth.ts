import { createHash } from "node:crypto"

import { AppError } from "../../http/errorCatalog.js"
import { symmetricHalfUpBasisPoints } from "../shared/moneyRounding.js"

export const MIN_GROWTH_BASIS_POINTS = -2_000
export const MAX_GROWTH_BASIS_POINTS = 2_000

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

export interface GrowthBasis {
  readonly principalPaise: bigint
  readonly currentValuePaise: bigint
}

export interface ClientPositionBasis extends GrowthBasis {
  readonly userId: string
  readonly latestEntryId: string | null
}

export interface PlannedGrowthTarget {
  readonly userId: string
  readonly principalPaise: bigint
  readonly beforePaise: bigint
  readonly deltaPaise: bigint
  readonly afterPaise: bigint
}

export interface CollectiveGrowthPlan {
  readonly instructionType: "percentage" | "explicit_deltas"
  readonly targets: readonly PlannedGrowthTarget[]
  readonly excludedCount: number
  readonly totalDeltaPaise: bigint
}

export interface CollectiveGrowthLimits {
  readonly maxTargets: number
}

const byUserId = <T extends { readonly userId: string }>(left: T, right: T): number =>
  left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0

const assertBasisPointsInRange = (growthBasisPoints: bigint): void => {
  if (
    growthBasisPoints === 0n ||
    growthBasisPoints < BigInt(MIN_GROWTH_BASIS_POINTS) ||
    growthBasisPoints > BigInt(MAX_GROWTH_BASIS_POINTS)
  ) {
    throw new AppError("VALIDATION_FAILED", {
      fields: {
        growthBasisPoints: [
          `Must be a non-zero rate between ${String(MIN_GROWTH_BASIS_POINTS)} and ${String(MAX_GROWTH_BASIS_POINTS)} basis points.`,
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

const assertPositivePrincipal = (principalPaise: bigint): void => {
  if (principalPaise <= 0n) {
    throw new AppError("VALIDATION_FAILED", {
      fields: {
        growthBasisPoints: [
          "A rate needs an invested amount to measure against. Use an exact amount instead.",
        ],
      },
    })
  }
}

const computeGrowthDelta = (basis: GrowthBasis, instruction: GrowthInstruction): bigint => {
  let delta: bigint
  if (instruction.kind === "amount") {
    assertNonZeroAmount(instruction.growthPaise)
    delta = instruction.growthPaise
  } else {
    assertBasisPointsInRange(instruction.growthBasisPoints)
    assertPositivePrincipal(basis.principalPaise)
    delta = symmetricHalfUpBasisPoints(basis.principalPaise, instruction.growthBasisPoints)
  }
  if (delta === 0n) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { growthBasisPoints: ["The rate rounds to a zero adjustment for this value."] },
    })
  }
  return delta
}

export const planIndividualGrowth = (
  basis: GrowthBasis,
  instruction: GrowthInstruction,
): Readonly<{
  principalPaise: bigint
  beforePaise: bigint
  deltaPaise: bigint
  afterPaise: bigint
}> => {
  const deltaPaise = computeGrowthDelta(basis, instruction)
  const afterPaise = basis.currentValuePaise + deltaPaise
  assertNonNegativeAfter(afterPaise)
  return {
    principalPaise: basis.principalPaise,
    beforePaise: basis.currentValuePaise,
    deltaPaise,
    afterPaise,
  }
}

const NO_ELIGIBLE_POSITIONS = (): AppError =>
  new AppError("STATE_CONFLICT", {
    message: "The fund has no eligible client positions for a growth batch.",
  })

export const planCollectiveClientGrowth = (
  positions: readonly ClientPositionBasis[],
  instruction: CollectiveGrowthInstruction,
  limits: CollectiveGrowthLimits,
): CollectiveGrowthPlan => {
  const eligible = positions.filter((p) => p.currentValuePaise > 0n)
  const excludedCount = positions.length - eligible.length

  if (instruction.kind === "percentage") {
    assertBasisPointsInRange(instruction.growthBasisPoints)
    if (eligible.length === 0) throw NO_ELIGIBLE_POSITIONS()
    if (eligible.length > limits.maxTargets) {
      throw new AppError("VALIDATION_FAILED", {
        fields: { fundId: [`The fund has more than ${String(limits.maxTargets)} eligible positions.`] },
      })
    }
    const targets = eligible
      .map((p) => ({
        userId: p.userId,
        principalPaise: p.principalPaise,
        beforePaise: p.currentValuePaise,
        deltaPaise: symmetricHalfUpBasisPoints(p.principalPaise, instruction.growthBasisPoints),
      }))
      .filter((target) => target.deltaPaise !== 0n)
      .map((target) => ({ ...target, afterPaise: target.beforePaise + target.deltaPaise }))
      .sort(byUserId)
    if (targets.length === 0) throw NO_ELIGIBLE_POSITIONS()
    if (targets.some((target) => target.afterPaise < 0n)) {
      throw new AppError("VALIDATION_FAILED", {
        fields: {
          growthBasisPoints: ["This rate would take at least one position below zero."],
        },
      })
    }
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
      fields: { items: [`Must list at most ${String(limits.maxTargets)} targets.`] },
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
      principalPaise: position.principalPaise,
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
        positions: sorted.map((p) => [
          p.userId,
          p.principalPaise.toString(),
          p.currentValuePaise.toString(),
          p.latestEntryId,
        ]),
      }),
    )
    .digest("hex")
}
