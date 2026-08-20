/**
 * Money rounding for basis-point arithmetic (spec §8.1). All money is integer
 * paise carried as `bigint`; applying a growth rate means multiplying by basis
 * points and dividing by 10_000, rounding to the nearest paise.
 *
 * The rule is symmetric half-up on the product's magnitude: the sign of the
 * instruction (`basisPoints`) decides the direction, so a loss rounds away from
 * zero exactly as a gain does and no sign-dependent drift accumulates.
 */

/**
 * `floor((abs(basisPaise * basisPoints) + 5000) / 10000) * sign(basisPoints)`.
 * Zero basis points always yield zero, regardless of the basis.
 */
export const symmetricHalfUpBasisPoints = (basisPaise: bigint, basisPoints: bigint): bigint => {
  const product = basisPaise * basisPoints
  const magnitude = product < 0n ? -product : product
  const rounded = (magnitude + 5000n) / 10000n
  return basisPoints < 0n ? -rounded : rounded
}
