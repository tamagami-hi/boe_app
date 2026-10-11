import { AppError } from "../../http/errorCatalog.js"

const E164 = /^\+[1-9][0-9]{7,14}$/u
const SEPARATORS = /[\s()-]/gu
const VISIBLE_DIGITS = 4

export const normalizePhone = (raw: string): string => {
  const candidate = raw.replace(SEPARATORS, "")
  if (!E164.test(candidate)) {
    throw new AppError("VALIDATION_FAILED", { fields: { phone: ["must be a valid E.164 phone number"] } })
  }
  return candidate
}

export const phoneEnding = (phoneE164: string): string => phoneE164.slice(-VISIBLE_DIGITS)
