import { AppError } from "../../http/errorCatalog.js"

const E164 = /^\+[1-9][0-9]{7,14}$/u
const INDIA_PREFIX = "+91"
const INDIA_NATIONAL = /^\+91[0-9]{10}$/u
const SEPARATORS = /[\s()-]/gu
const VISIBLE_DIGITS = 4

const refuse = (message: string): never => {
  throw new AppError("VALIDATION_FAILED", { fields: { phone: [message] } })
}

export const normalizePhone = (raw: string): string => {
  const candidate = raw.replace(SEPARATORS, "")
  if (!E164.test(candidate)) return refuse("must be a valid E.164 phone number")
  if (candidate.startsWith(INDIA_PREFIX) && !INDIA_NATIONAL.test(candidate)) {
    return refuse("an Indian number must have exactly 10 digits after +91")
  }
  return candidate
}

export const phoneEnding = (phoneE164: string): string => phoneE164.slice(-VISIBLE_DIGITS)
