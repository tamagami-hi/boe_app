/**
 * Fund AUM growth arithmetic (core mechanism spec §8.3/§8.4/§8.5).
 *
 * Pure calculation only — no I/O, no imports from other financial modules. A
 * growth instruction is applied to each fund's own latest authoritative
 * snapshot; a collective plan is a fan-out of independent per-fund
 * calculations, never the distribution of one shared total.
 *
 * Money is integer paise carried as `bigint`; it crosses into this module as
 * `bigint` and out of it the same way. Percentage growth uses the shared
 * symmetric half-up basis-point rule from `domain/shared/moneyRounding.ts`.
 */
import { createHash } from "node:crypto"

import { AppError } from "../../http/errorCatalog.js"
import { symmetricHalfUpBasisPoints } from "../shared/moneyRounding.js"

/** One fund's latest authoritative snapshot state — the basis for growth. */
export interface AumFundBasis {
  readonly fundId: string
  readonly latestSnapshotId: string
  readonly aumPaise: bigint
  readonly revision: number
}

export type AumGrowthInstruction =
  | { readonly kind: "amount"; readonly growthPaise: bigint }
  | { readonly kind: "percentage"; readonly growthBasisPoints: bigint }

/**
 * Signed delta for one fund (spec §8.3): amount mode is the delta verbatim;
 * percentage mode is `symmetricHalfUp(basis * basisPoints / 10,000)`.
 */
export const aumGrowthDelta = (basisAumPaise: bigint, instruction: AumGrowthInstruction): bigint =>
  instruction.kind === "amount"
    ? instruction.growthPaise
    : symmetricHalfUpBasisPoints(basisAumPaise, instruction.growthBasisPoints)

export const assertAumDeltaNonZero = (deltaPaise: bigint): void => {
  if (deltaPaise === 0n) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { growthBasisPoints: ["The rate rounds to a zero adjustment for this value."] },
    })
  }
}

/** Collective instruction: one common rate XOR an explicit signed delta per fund. */
export type CollectiveAumInstruction =
  | { readonly type: "percentage"; readonly growthBasisPoints: number }
  | {
      readonly type: "explicit_deltas"
      readonly items: readonly { readonly fundId: string; readonly growthPaise: bigint }[]
    }

export interface AumGrowthPlanItem {
  readonly fundId: string
  readonly basisSnapshotId: string
  readonly basisRevision: number
  readonly beforeAumPaise: bigint
  readonly deltaPaise: bigint
  readonly afterAumPaise: bigint
}

export type AumGrowthPlan =
  | {
      readonly ok: true
      readonly items: readonly AumGrowthPlanItem[]
      readonly totalDeltaPaise: bigint
    }
  | { readonly ok: false; readonly invalidFundIds: readonly string[] }

const byFundId = <T extends { readonly fundId: string }>(left: T, right: T): number =>
  left.fundId < right.fundId ? -1 : left.fundId > right.fundId ? 1 : 0

/**
 * Compute one fund's after-value from its own basis (spec §8.4). Explicit
 * deltas are looked up by fund id; a missing entry is a programming error, not
 * input, because the route validates that every target has exactly one delta.
 */
export const planAumGrowth = (
  bases: readonly AumFundBasis[],
  instruction: CollectiveAumInstruction,
): AumGrowthPlan => {
  const explicit = instruction.type === "explicit_deltas" ? new Map(
    instruction.items.map((item) => [item.fundId, item.growthPaise]),
  ) : null

  const items: AumGrowthPlanItem[] = []
  const invalidFundIds: string[] = []
  let totalDeltaPaise = 0n

  for (const basis of [...bases].sort(byFundId)) {
    const delta =
      instruction.type === "percentage"
        ? symmetricHalfUpBasisPoints(basis.aumPaise, BigInt(instruction.growthBasisPoints))
        : explicit?.get(basis.fundId)
    if (delta === undefined) throw new Error(`collective instruction has no delta for ${basis.fundId}`)
    assertAumDeltaNonZero(delta)
    const after = basis.aumPaise + delta
    if (after < 0n) {
      invalidFundIds.push(basis.fundId)
      continue
    }
    totalDeltaPaise += delta
    items.push({
      fundId: basis.fundId,
      basisSnapshotId: basis.latestSnapshotId,
      basisRevision: basis.revision,
      beforeAumPaise: basis.aumPaise,
      deltaPaise: delta,
      afterAumPaise: after,
    })
  }

  return invalidFundIds.length === 0 ? { ok: true, items, totalDeltaPaise } : { ok: false, invalidFundIds }
}

/**
 * The canonical command object hashed into `basisHash` (spec §8.5). Explicit
 * deltas are sorted by fund id and money serializes as decimal strings, so the
 * pre-commit read and the locked commit compute byte-identical input for the
 * same instruction.
 */
export const canonicalCollectiveAumCommand = (
  asOfDate: string,
  instruction: CollectiveAumInstruction,
): Readonly<Record<string, unknown>> => ({
  asOfDate,
  instruction:
    instruction.type === "percentage"
      ? { type: "percentage", growthBasisPoints: instruction.growthBasisPoints }
      : {
          type: "explicit_deltas",
          items: [...instruction.items]
            .sort(byFundId)
            .map((item) => ({ fundId: item.fundId, growthPaise: item.growthPaise.toString() })),
        },
})

/**
 * SHA-256 over `command + sorted(fundId, latestSnapshotId, aumPaise, revision)`
 * (spec §8.5). Hex, because `aum_growth_batches.basis_hash` is text.
 */
export const computeAumBasisHash = (
  command: Readonly<Record<string, unknown>>,
  bases: readonly AumFundBasis[],
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        command,
        funds: [...bases].sort(byFundId).map((basis) => ({
          fundId: basis.fundId,
          latestSnapshotId: basis.latestSnapshotId,
          aumPaise: basis.aumPaise.toString(),
          revision: basis.revision,
        })),
      }),
    )
    .digest("hex")
