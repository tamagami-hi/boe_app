/**
 * Exact, centralized financial arithmetic (spec 03 §1, §4.3). INR amounts are
 * integer paise; NAV and units are decimals at scale 8. All arithmetic is done
 * with BigInt integers — never JavaScript floating point — and rounding is
 * round-half-to-even (banker's rounding), applied exactly once.
 *
 * For an amount-based allotment (spec 03 §4.3):
 *   units = amount_paise / 100 / nav, rounded once to 8 decimals (half-to-even).
 *
 * Working entirely in scaled integers, with nav scaled to 8 decimals
 * (`navScaled8 = nav * 1e8`):
 *   unitsScaled8 = roundHalfEven( amount_paise * 1e14 / navScaled8 )
 * because units*1e8 = amount_paise*1e8 / (100 * nav) = amount_paise*1e14 / navScaled8.
 */

export const SCALE_8 = 8
/** 1e14 = 1e8 (units scale) * 1e8 (nav scale) / 1e2 (paise->rupees). */
const AMOUNT_TO_UNITS_FACTOR = 10n ** 14n

/**
 * Parse a non-negative decimal string (e.g. a `numeric(24,8)` NAV rendered as
 * text) into an integer scaled by 10^scale. Rejects malformed input or more
 * fractional digits than `scale` (which would silently lose precision).
 */
export const parseDecimalToScaled = (text: string, scale: number): bigint => {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(text.trim())
  if (match === null) throw new RangeError(`invalid decimal: ${text}`)
  const integerPart = match[1] ?? "0"
  const fractionPart = match[2] ?? ""
  if (fractionPart.length > scale) {
    throw new RangeError(`decimal ${text} exceeds scale ${scale}`)
  }
  const paddedFraction = fractionPart.padEnd(scale, "0")
  return BigInt(integerPart) * 10n ** BigInt(scale) + BigInt(paddedFraction === "" ? "0" : paddedFraction)
}

/**
 * Integer division rounded half-to-even. `denominator` must be non-zero; the
 * sign of the result follows ordinary truncated division extended by the
 * banker's-rounding tie rule.
 */
export const roundHalfEvenDiv = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator === 0n) throw new RangeError("division by zero")
  // Normalize so the denominator is positive; fold its sign into the numerator.
  const negDen = denominator < 0n
  const den = negDen ? -denominator : denominator
  const num = negDen ? -numerator : numerator

  const quotient = num / den // truncates toward zero
  const remainder = num - quotient * den // same sign as num
  if (remainder === 0n) return quotient

  const twiceAbsRemainder = 2n * (remainder < 0n ? -remainder : remainder)
  const awayFromZero = num > 0n ? quotient + 1n : quotient - 1n
  if (twiceAbsRemainder < den) return quotient
  if (twiceAbsRemainder > den) return awayFromZero
  // Exactly halfway: round to the even neighbour.
  return quotient % 2n === 0n ? quotient : awayFromZero
}

/** Format a scaled integer back into a fixed-scale decimal string. */
export const formatScaled = (value: bigint, scale: number): string => {
  const negative = value < 0n
  const absolute = (negative ? -value : value).toString().padStart(scale + 1, "0")
  const integerPart = absolute.slice(0, absolute.length - scale)
  const fractionPart = absolute.slice(absolute.length - scale)
  return `${negative ? "-" : ""}${integerPart}.${fractionPart}`
}

/**
 * Units allotted for an amount-based purchase, at scale 8, rounded once
 * half-to-even. `amountPaise` is integer paise (> 0); `navText` is the fund's
 * current NAV as a decimal string (> 0).
 */
export const computeAllotmentUnits = (amountPaise: bigint, navText: string): string => {
  if (amountPaise <= 0n) throw new RangeError("amountPaise must be positive")
  const navScaled8 = parseDecimalToScaled(navText, SCALE_8)
  if (navScaled8 <= 0n) throw new RangeError("nav must be positive")
  const unitsScaled8 = roundHalfEvenDiv(amountPaise * AMOUNT_TO_UNITS_FACTOR, navScaled8)
  return formatScaled(unitsScaled8, SCALE_8)
}

/** Convenience: the scaled-8 integer form of the allotted units. */
export const computeAllotmentUnitsScaled8 = (amountPaise: bigint, navText: string): bigint =>
  roundHalfEvenDiv(amountPaise * AMOUNT_TO_UNITS_FACTOR, parseDecimalToScaled(navText, SCALE_8))
