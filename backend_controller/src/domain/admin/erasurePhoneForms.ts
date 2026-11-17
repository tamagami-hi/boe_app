const INDIA_PREFIX = "+91"
const INDIA_NUMBER_LENGTH = 13
const NATIONAL_DIGITS = /^\d{10}$/u
const NATIONAL_HALF = 5
const SEPARATOR = "[ -]?"
const NATIONAL_PREFIX = `(?:(?:\\+91|91|0)${SEPARATOR})?`
const FREE_TEXT = /[\p{L}\s]/u
const MOBILE_BEFORE = "(?<![\\p{L}\\p{N}_-])"
const MOBILE_AFTER = "(?![\\p{L}\\p{N}_])"
const INDIAN_MOBILE = `${MOBILE_BEFORE}${NATIONAL_PREFIX}[6-9]\\d{4}${SEPARATOR}\\d{5}${MOBILE_AFTER}`

export const NATIONAL_NUMBER_LENGTH = 10

export type JsonEntryScrub = (key: string, item: unknown, walk: (item: unknown) => unknown) => unknown

export const isFreeText = (value: string): boolean => FREE_TEXT.test(value)

export const nationalNumberOf = (phone: string): string | null => {
  if (!phone.startsWith(INDIA_PREFIX) || phone.length !== INDIA_NUMBER_LENGTH) return null
  const national = phone.slice(INDIA_PREFIX.length)
  return NATIONAL_DIGITS.test(national) ? national : null
}

export const nationalFormsSource = (national: string): string =>
  `${NATIONAL_PREFIX}${national.slice(0, NATIONAL_HALF)}${SEPARATOR}${national.slice(NATIONAL_HALF)}`

export const walkJsonStrings = (
  value: unknown,
  scrub: (text: string) => string,
  entry: JsonEntryScrub = (key, item, walk) => walk(item),
): unknown => {
  const walk = (item: unknown): unknown => walkJsonStrings(item, scrub, entry)
  if (typeof value === "string") return scrub(value)
  if (Array.isArray(value)) return value.map(walk)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, entry(key, item, walk)]),
  )
}

export const replaceIndianMobiles = (value: string, replacement: string): string =>
  isFreeText(value) ? value.replace(new RegExp(INDIAN_MOBILE, "gu"), replacement) : value

export const mentionsIndianMobile = (value: string): boolean =>
  isFreeText(value) && new RegExp(INDIAN_MOBILE, "u").test(value)
