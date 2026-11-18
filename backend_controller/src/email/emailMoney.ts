import { groupIndian } from "../domain/shared/displayText.js"
import { EmailValidationError } from "./emailValidation.js"

const CANONICAL_PAISE = /^(0|[1-9][0-9]{0,18})$/u
const CALENDAR_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u
const PAISE_PER_RUPEE = 100n

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

export const formatRupeesFromPaise = (paise: string): string => {
  if (!CANONICAL_PAISE.test(paise)) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  const value = BigInt(paise)
  const rupees = (value / PAISE_PER_RUPEE).toString()
  const fraction = (value % PAISE_PER_RUPEE).toString().padStart(2, "0")
  return `₹${groupIndian(rupees)}.${fraction}`
}

export const formatCalendarDate = (date: string): string => {
  const match = CALENDAR_DATE.exec(date)
  const month = match === null ? undefined : MONTH_NAMES[Number(match[2]) - 1]
  const day = match === null ? 0 : Number(match[3])
  if (match === null || month === undefined || day < 1 || day > 31) {
    throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  }
  return `${String(day)} ${month} ${match[1] ?? ""}`
}

const CALENDAR_MONTH = /^([0-9]{4})-([0-9]{2})$/u

export const formatCalendarMonth = (month: string): string => {
  const match = CALENDAR_MONTH.exec(month)
  const name = match === null ? undefined : MONTH_NAMES[Number(match[2]) - 1]
  if (match === null || name === undefined) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return `${name} ${match[1] ?? ""}`
}
