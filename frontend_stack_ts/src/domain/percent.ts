const PERCENT_FRACTION_DIGITS = 2

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
