import { maskEmail } from "../../crypto/primitives.js"
import { isReservedEmail, RELEASED_PHONE_PREFIX } from "../shared/reservedContacts.js"

export const ERASED_NAME = "Tombstoned"
export const ERASED_PHONE = "tombstone"
export const ERASED_HISTORY_PREVIOUS_PHONE = "tombstone-previous"
export const ERASED_HISTORY_NEW_PHONE = "tombstone-new"

const ERASED_EMAIL_DOMAIN = "invalid.example"
const MIN_PHONE_DIGITS = 8
const INDIA_PREFIX = "+91"
const INDIA_NUMBER_LENGTH = 13

export const erasedEmailFor = (userId: string): string =>
  `tombstone+${userId.replaceAll("-", "")}@${ERASED_EMAIL_DOMAIN}`

export interface KnownContacts {
  readonly emails: readonly string[]
  readonly phones: readonly string[]
  readonly names: readonly string[]
}

export interface ContactScrubber {
  readonly emails: readonly string[]
  readonly phones: readonly string[]
  readonly text: (value: string) => string
  readonly json: (value: unknown) => unknown
  readonly mentions: (value: string) => boolean
}

type Pair = readonly [needle: string, replacement: string]

const isErasedEmail = (email: string): boolean =>
  email.startsWith("tombstone+") && email.endsWith(`@${ERASED_EMAIL_DOMAIN}`)

export const isPlaceholderEmail = (email: string): boolean => isErasedEmail(email) || isReservedEmail(email)

export const isPlaceholderPhone = (phone: string): boolean =>
  phone.startsWith(RELEASED_PHONE_PREFIX) || phone.startsWith(ERASED_PHONE)

const distinct = (values: readonly string[]): string[] => [...new Set(values)]

const realEmails = (emails: readonly string[]): string[] =>
  distinct(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@") && !isPlaceholderEmail(email)))

const realPhones = (phones: readonly string[]): string[] =>
  distinct(phones.map((phone) => phone.trim()).filter((phone) => phone.length >= MIN_PHONE_DIGITS && !isPlaceholderPhone(phone)))

const phoneVariants = (phone: string): string[] => {
  const digits = phone.replace(/^\+/u, "")
  const national =
    phone.startsWith(INDIA_PREFIX) && phone.length === INDIA_NUMBER_LENGTH ? [phone.slice(INDIA_PREFIX.length)] : []
  return [phone, digits, ...national].filter((variant) => variant.replace(/\D/gu, "").length >= MIN_PHONE_DIGITS)
}

const byLongestNeedle = (pairs: readonly Pair[]): Pair[] =>
  [...pairs].sort((left, right) => right[0].length - left[0].length)

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const replaceAll = (value: string, pairs: readonly Pair[]): string =>
  pairs.reduce(
    (current, [needle, replacement]) => current.replace(new RegExp(escapeRegExp(needle), "giu"), replacement),
    value,
  )

const scrubJson = (
  value: unknown,
  pairs: readonly Pair[],
  names: ReadonlySet<string>,
): unknown => {
  if (typeof value === "string") {
    return names.has(value.trim()) ? ERASED_NAME : replaceAll(value, pairs)
  }
  if (Array.isArray(value)) return value.map((item) => scrubJson(item, pairs, names))
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      key === "nominee" && item !== null && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item as Record<string, unknown>).map(([field, text]) => [
              field,
              (field === "name" || field === "relation") && typeof text === "string" ? ERASED_NAME : text,
            ]),
          )
        : scrubJson(item, pairs, names),
    ]),
  )
}

export const createContactScrubber = (contacts: KnownContacts, userId: string): ContactScrubber => {
  const emails = realEmails(contacts.emails)
  const phones = realPhones(contacts.phones)
  const erasedEmail = erasedEmailFor(userId)
  const erasedMasked = maskEmail(erasedEmail)
  const emailPairs: Pair[] = emails.flatMap((email): Pair[] => [
    [email, erasedEmail],
    [maskEmail(email), erasedMasked],
  ])
  const jsonPairs = byLongestNeedle([...emailPairs, ...phones.map((phone): Pair => [phone, ERASED_PHONE])])
  const textPairs = byLongestNeedle([
    ...emailPairs,
    ...phones.flatMap((phone) => phoneVariants(phone).map((variant): Pair => [variant, ERASED_PHONE])),
  ])
  const names = new Set(
    contacts.names.map((name) => name.trim()).filter((name) => name.length > 0 && name !== ERASED_NAME),
  )
  const lowerNeedles = textPairs.map(([needle]) => needle.toLowerCase())
  return {
    emails,
    phones,
    text: (value) => replaceAll(value, textPairs),
    json: (value) => scrubJson(value, jsonPairs, names),
    mentions: (value) => {
      const lower = value.toLowerCase()
      return lowerNeedles.some((needle) => lower.includes(needle))
    },
  }
}
