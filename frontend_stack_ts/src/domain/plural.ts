export const pluralise = (count: number, singular: string, plural?: string): string =>
  count === 1 ? singular : (plural ?? `${singular}s`)

export const countOf = (count: number, singular: string, plural?: string): string =>
  `${String(count)} ${pluralise(count, singular, plural)}`

export const monthsLabel = (months: number): string => countOf(months, "month")
