import { isApiError } from "~/api/errors"

const PHONE_SEPARATORS = /[\s()-]/gu
const E164 = /^\+[1-9][0-9]{7,14}$/u
const INDIA_PREFIX = "+91"
const INDIA_NATIONAL = /^\+91[0-9]{10}$/u
const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 120

export type ContactField = "fullName" | "email" | "phone"

export type ClientContact = Readonly<Record<ContactField, string>>

export type FieldRefusal = Readonly<{ value: string; message: string }>

export type FieldRefusals = Readonly<Partial<Record<ContactField, FieldRefusal>>>

const CONTACT_FIELDS: readonly ContactField[] = ["fullName", "email", "phone"]

const PHONE_FORMAT = "Use an international number, starting with +."
const INDIA_LENGTH = "An Indian number has 10 digits after +91."

const CONFLICT_COPY: Readonly<Record<ContactField, string>> = {
  fullName: "Check this name.",
  email: "Already used by an account or a signup in progress.",
  phone: "Already used by an account or a signup in progress.",
}

const VALIDATION_COPY: Readonly<Record<ContactField, string>> = {
  fullName: "Use between 2 and 120 characters, without control characters.",
  email: "Check this email address.",
  phone: `${PHONE_FORMAT} ${INDIA_LENGTH}`,
}

export const normalizedPhone = (raw: string): string => raw.replace(PHONE_SEPARATORS, "")

export const phoneProblem = (raw: string): string | null => {
  if (raw === "") return null
  const phone = normalizedPhone(raw)
  if (!E164.test(phone)) return PHONE_FORMAT
  if (phone.startsWith(INDIA_PREFIX) && !INDIA_NATIONAL.test(phone)) return INDIA_LENGTH
  return null
}

export const nameProblem = (trimmed: string): string | null => {
  if (trimmed === "") return null
  const length = Array.from(trimmed).length
  return length < MIN_NAME_LENGTH || length > MAX_NAME_LENGTH ? "Use between 2 and 120 characters." : null
}

export const fieldRefusals = (error: unknown, submitted: ClientContact): FieldRefusals => {
  if (!isApiError(error) || error.fields === null) return {}
  const copy = error.code === "STATE_CONFLICT" ? CONFLICT_COPY : VALIDATION_COPY
  const fields = error.fields
  return Object.fromEntries(
    CONTACT_FIELDS.filter((field) => Object.hasOwn(fields, field)).map((field) => [
      field,
      { value: submitted[field], message: copy[field] },
    ]),
  )
}

export const refusalFor = (
  refusals: FieldRefusals,
  field: ContactField,
  current: ClientContact,
): string | undefined => {
  const refusal = refusals[field]
  return refusal?.value === current[field] ? refusal.message : undefined
}
