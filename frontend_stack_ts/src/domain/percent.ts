const PERCENT_FRACTION_DIGITS = 2
const BASIS_POINTS_PER_PERCENT = 100n
const BASIS_POINTS_PATTERN = /^-?(0|[1-9][0-9]*)$/u

export const PERCENT_ABSENT = "—"

const percentFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: PERCENT_FRACTION_DIGITS,
  maximumFractionDigits: PERCENT_FRACTION_DIGITS,
})

export type PercentFormatOptions = Readonly<{
  showSign?: boolean
}>

export const formatPercent = (
  value: number | null,
  options: PercentFormatOptions = {},
): string => {
  if (value === null || !Number.isFinite(value)) return PERCENT_ABSENT
  const formatted = `${percentFormatter.format(Math.abs(value))}%`
  if (value < 0) return `-${formatted}`
  if (options.showSign === true && value > 0) return `+${formatted}`
  return formatted
}

const wholePercentFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 })

export const formatBasisPoints = (
  value: string | null,
  options: PercentFormatOptions = {},
): string => {
  if (value === null || !BASIS_POINTS_PATTERN.test(value)) return PERCENT_ABSENT
  const basisPoints = BigInt(value)
  const magnitude = basisPoints < 0n ? -basisPoints : basisPoints
  const whole = wholePercentFormatter.format(magnitude / BASIS_POINTS_PER_PERCENT)
  const fraction = (magnitude % BASIS_POINTS_PER_PERCENT).toString().padStart(2, "0")
  const formatted = `${whole}.${fraction}%`
  if (basisPoints < 0n) return `-${formatted}`
  if (options.showSign === true && basisPoints > 0n) return `+${formatted}`
  return formatted
}
