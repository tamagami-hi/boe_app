import { formatCalendarDate, formatRupeesFromPaise } from "./emailMoney.js"
import { EmailValidationError } from "./emailValidation.js"

const SIGNED_NON_ZERO_PAISE = /^(-?)([1-9][0-9]{0,18})$/u
const MAX_PARTS = 200

export interface GrowthChange {
  readonly kind: "gain" | "loss"
  readonly amount: string
  readonly paise: bigint
}

const invalid = (): EmailValidationError => new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")

export const growthChangeOf = (value: unknown): GrowthChange => {
  const match = typeof value === "string" ? SIGNED_NON_ZERO_PAISE.exec(value) : null
  if (match === null || typeof value !== "string") throw invalid()
  return { kind: match[1] === "-" ? "loss" : "gain", amount: formatRupeesFromPaise(match[2] ?? ""), paise: BigInt(value) }
}

const recordOf = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid()
  return value as Readonly<Record<string, unknown>>
}

const textField = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key]
  if (typeof value !== "string") throw invalid()
  return value
}

const subjectOf = (part: Readonly<Record<string, unknown>>): string => {
  if (part.kind === "sip") return "Your SIP"
  const invested = formatRupeesFromPaise(textField(part, "investedPaise"))
  const date = formatCalendarDate(textField(part, "effectiveDate"))
  if (part.kind === "one_time") return `Your one-time investment of ${invested} from ${date}`
  if (part.kind === "investment") return `Your investment of ${invested} from ${date}`
  throw invalid()
}

export const growthPartLines = (parts: unknown, netPaise: bigint): readonly string[] => {
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > MAX_PARTS) throw invalid()
  const lines = parts.map((value: unknown) => {
    const part = recordOf(value)
    const change = growthChangeOf(part.deltaPaise)
    return { text: `${subjectOf(part)}: a ${change.kind} of ${change.amount}.`, paise: change.paise }
  })
  if (lines.reduce((sum, line) => sum + line.paise, 0n) !== netPaise) throw invalid()
  return lines.map((line) => line.text)
}
