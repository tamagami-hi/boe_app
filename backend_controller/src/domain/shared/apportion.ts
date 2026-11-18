interface Quotient {
  readonly floor: bigint
  readonly remainder: bigint
  readonly index: number
}

const floorQuotient = (numerator: bigint, denominator: bigint, index: number): Quotient => {
  const sign = denominator < 0n ? -1n : 1n
  const top = numerator * sign
  const bottom = denominator * sign
  const truncated = top / bottom
  const floor = top % bottom !== 0n && top < 0n ? truncated - 1n : truncated
  return { floor, remainder: top - floor * bottom, index }
}

export const apportion = (total: bigint, weights: readonly bigint[]): readonly bigint[] => {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n)
  if (weights.length === 0 || weightSum === 0n) throw new RangeError("apportion needs weights with a non-zero sum")
  const quotients = weights.map((weight, index) => floorQuotient(total * weight, weightSum, index))
  const shortfall = Number(total - quotients.reduce((sum, quotient) => sum + quotient.floor, 0n))
  const topUps = new Set(
    [...quotients]
      .sort((left, right) => (left.remainder === right.remainder ? left.index - right.index : left.remainder > right.remainder ? -1 : 1))
      .slice(0, shortfall)
      .map((quotient) => quotient.index),
  )
  return quotients.map((quotient) => (topUps.has(quotient.index) ? quotient.floor + 1n : quotient.floor))
}
