/**
 * Pool growth distribution — Option B module 2, the "whole pool at once" path.
 *
 * Allocating growth investor by investor is correct but tedious: a pool's monthly
 * result is one number, and every investor should receive the share of it their
 * money earned. This module turns that one number into per-investor amounts.
 *
 * Two ways to express the same instruction:
 *
 *   amount   "distribute ₹4,50,000 across the pool"
 *   percent  "the pool grew 3.5%" — each investor gets 3.5% of their own value
 *
 * Both are resolved against each investor's **current value**, which is what has
 * actually been at work in the pool, and both are exact:
 *
 *  - Nothing is invented or lost. The allocated amounts sum to exactly the pool
 *    total, to the paise. Integer division leaves a remainder, which is handed out
 *    one paisa at a time by largest fractional part (ties by larger value, then by
 *    investor id) so the split is deterministic and reproducible.
 *  - An investor with no value receives nothing, because a share of zero is zero.
 *  - A loss distributes the same way and can never take an investor below zero,
 *    since each share is bounded by that investor's own value.
 *
 * Pure: no clock, no database, no rounding surprises.
 */

export interface PoolMember {
  readonly userId: string
  /** The investor's current value in this pool, in paise. */
  readonly currentValuePaise: bigint
}

export interface PoolShare {
  readonly userId: string
  readonly currentValuePaise: bigint
  /** Signed paise to allocate; negative for a loss. */
  readonly gainPaise: bigint
}

export interface PoolSplitResult {
  readonly shares: readonly PoolShare[]
  /** Sum of the shares — equal to the requested total by construction. */
  readonly allocatedPaise: bigint
  /** Pool value the split was computed against. */
  readonly basisPaise: bigint
}

const absolute = (value: bigint): bigint => (value < 0n ? -value : value)

/**
 * Split a signed total across members in proportion to their current value.
 *
 * The remainder is distributed by largest fractional part. Fractions are compared
 * without floating point: member i's exact share is `total * valueᵢ / basis`, so
 * the fractional part is ranked by `(total * valueᵢ) mod basis`.
 */
export const splitPoolGainByAmount = (
  members: readonly PoolMember[],
  totalGainPaise: bigint,
): PoolSplitResult => {
  const basisPaise = members.reduce((sum, member) => sum + member.currentValuePaise, 0n)
  if (basisPaise <= 0n || totalGainPaise === 0n) {
    return {
      shares: members.map((member) => ({
        userId: member.userId,
        currentValuePaise: member.currentValuePaise,
        gainPaise: 0n,
      })),
      allocatedPaise: 0n,
      basisPaise,
    }
  }

  const negative = totalGainPaise < 0n
  const magnitude = absolute(totalGainPaise)

  // Floor share plus the ranking key for the leftover paise.
  const draft = members.map((member) => {
    const numerator = magnitude * member.currentValuePaise
    return {
      userId: member.userId,
      currentValuePaise: member.currentValuePaise,
      base: numerator / basisPaise,
      remainder: numerator % basisPaise,
    }
  })

  let distributed = draft.reduce((sum, share) => sum + share.base, 0n)
  let leftover = magnitude - distributed

  // Largest fractional part first; ties go to the larger holding, then to the
  // lexicographically smaller id so the outcome never depends on input order.
  const ranked = [...draft].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1
    if (left.currentValuePaise !== right.currentValuePaise) {
      return left.currentValuePaise > right.currentValuePaise ? -1 : 1
    }
    return left.userId < right.userId ? -1 : 1
  })

  const bonus = new Map<string, bigint>()
  for (const share of ranked) {
    if (leftover <= 0n) break
    // Only members with a holding can take a leftover paisa.
    if (share.currentValuePaise <= 0n) continue
    bonus.set(share.userId, 1n)
    leftover -= 1n
    distributed += 1n
  }

  const shares = draft.map((share) => {
    const amount = share.base + (bonus.get(share.userId) ?? 0n)
    return {
      userId: share.userId,
      currentValuePaise: share.currentValuePaise,
      gainPaise: negative ? -amount : amount,
    }
  })

  return {
    shares,
    allocatedPaise: negative ? -distributed : distributed,
    basisPaise,
  }
}

/**
 * Split by growth percentage. Each investor receives that percentage of their own
 * value, so the pool total follows from the members rather than being fixed up
 * front. `percentBasisPoints` keeps the input exact: 350 is 3.50%.
 *
 * Per-investor rounding is half-up on the magnitude, which keeps a gain from
 * silently rounding to zero for small holdings.
 */
export const splitPoolGainByPercent = (
  members: readonly PoolMember[],
  percentBasisPoints: number,
): PoolSplitResult => {
  const basisPaise = members.reduce((sum, member) => sum + member.currentValuePaise, 0n)
  const points = BigInt(Math.trunc(percentBasisPoints))
  if (points === 0n) {
    return {
      shares: members.map((member) => ({
        userId: member.userId,
        currentValuePaise: member.currentValuePaise,
        gainPaise: 0n,
      })),
      allocatedPaise: 0n,
      basisPaise,
    }
  }

  const negative = points < 0n
  const magnitude = absolute(points)
  // basis points: value * bp / 10_000, half-up.
  const DENOMINATOR = 10_000n
  let allocated = 0n
  const shares = members.map((member) => {
    const numerator = member.currentValuePaise * magnitude
    const floor = numerator / DENOMINATOR
    const rounded = numerator % DENOMINATOR >= DENOMINATOR / 2n ? floor + 1n : floor
    allocated += rounded
    return {
      userId: member.userId,
      currentValuePaise: member.currentValuePaise,
      gainPaise: negative ? -rounded : rounded,
    }
  })

  return { shares, allocatedPaise: negative ? -allocated : allocated, basisPaise }
}
