import { toPaise } from "~/domain/money"

const FORMULA_LEADS: ReadonlySet<string> = new Set(["=", "+", "-", "@", "\t", "\r"])
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/u
const NEEDS_QUOTES = /[",\r\n]/u
const RECORD_SEPARATOR = "\r\n"
const PAISE_PER_RUPEE = 100n
const INDIA_UTC_OFFSET_MS = 330 * 60 * 1000

export const guardFormula = (value: string): string => {
  if (value === "" || PLAIN_DECIMAL.test(value)) return value
  return FORMULA_LEADS.has(value.charAt(0)) ? `'${value}` : value
}

export const csvCell = (value: string): string => {
  const guarded = guardFormula(value)
  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded
}

export const toCsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header, ...rows].map((row) => row.map(csvCell).join(",")).join(RECORD_SEPARATOR) + RECORD_SEPARATOR

export const paiseToRupeeText = (paise: string): string => {
  const value = BigInt(toPaise(paise))
  const isNegative = value < 0n
  const magnitude = isNegative ? -value : value
  const fraction = (magnitude % PAISE_PER_RUPEE).toString().padStart(2, "0")
  return `${isNegative ? "-" : ""}${(magnitude / PAISE_PER_RUPEE).toString()}.${fraction}`
}

export const indiaDateTimeText = (isoDateTime: string): string => {
  const shifted = new Date(Date.parse(isoDateTime) + INDIA_UTC_OFFSET_MS).toISOString()
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 19)}`
}
