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
const EMAIL_BEFORE = "(?<![\\p{L}\\p{N}._%+-])"
const EMAIL_AFTER = "(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])"
const DIGITS_BEFORE = "(?<!\\d)"
const DIGITS_AFTER = "(?!\\d)"
const WORD_BEFORE = "(?<![\\p{L}\\p{N}\\p{M}])"
const WORD_AFTER = "(?![\\p{L}\\p{N}\\p{M}])"

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
  readonly ownText: (value: string) => string
  readonly json: (value: unknown) => unknown
  readonly mentions: (value: string) => boolean
}

interface Replacement {
  readonly pattern: RegExp
  readonly replacement: string
  readonly length: number
}

const isErasedEmail = (email: string): boolean =>
  email.startsWith("tombstone+") && email.endsWith(`@${ERASED_EMAIL_DOMAIN}`)

export const isPlaceholderEmail = (email: string): boolean => isErasedEmail(email) || isReservedEmail(email)

export const isPlaceholderPhone = (phone: string): boolean =>
  phone.startsWith(RELEASED_PHONE_PREFIX) || phone.startsWith(ERASED_PHONE)

const distinct = (values: readonly string[]): string[] => [...new Set(values)]

export const realEmails = (emails: readonly string[]): string[] =>
  distinct(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@") && !isPlaceholderEmail(email)))

export const realPhones = (phones: readonly string[]): string[] =>
  distinct(phones.map((phone) => phone.trim()).filter((phone) => phone.length >= MIN_PHONE_DIGITS && !isPlaceholderPhone(phone)))

const phoneVariants = (phone: string): string[] => {
  const digits = phone.replace(/^\+/u, "")
  const national =
    phone.startsWith(INDIA_PREFIX) && phone.length === INDIA_NUMBER_LENGTH ? [phone.slice(INDIA_PREFIX.length)] : []
  return distinct([phone, digits, ...national]).filter((variant) => variant.replace(/\D/gu, "").length >= MIN_PHONE_DIGITS)
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const bounded = (needle: string, before: string, after: string, replacement: string): Replacement => ({
  pattern: new RegExp(`${before}${escapeRegExp(needle)}${after}`, "giu"),
  replacement,
  length: needle.length,
})

const byLongestNeedle = (replacements: readonly Replacement[]): Replacement[] =>
  [...replacements].sort((left, right) => right.length - left.length)

const replaceAll = (value: string, replacements: readonly Replacement[]): string =>
  replacements.reduce((current, { pattern, replacement }) => current.replace(pattern, replacement), value)

const nomineeObject = (item: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(item).map(([field, text]) => [
      field,
      (field === "name" || field === "relation") && typeof text === "string" ? ERASED_NAME : text,
    ]),
  )

const scrubJson = (value: unknown, replacements: readonly Replacement[], names: ReadonlySet<string>): unknown => {
  if (typeof value === "string") return names.has(value.trim()) ? ERASED_NAME : replaceAll(value, replacements)
  if (Array.isArray(value)) return value.map((item) => scrubJson(item, replacements, names))
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      key === "nominee" && item !== null && typeof item === "object" && !Array.isArray(item)
        ? nomineeObject(item as Record<string, unknown>)
        : scrubJson(item, replacements, names),
    ]),
  )
}

const emailReplacements = (emails: readonly string[], userId: string): Replacement[] => {
  const erasedEmail = erasedEmailFor(userId)
  const erasedMasked = maskEmail(erasedEmail)
  return emails.flatMap((email) => [
    bounded(email, EMAIL_BEFORE, EMAIL_AFTER, erasedEmail),
    bounded(maskEmail(email), EMAIL_BEFORE, EMAIL_AFTER, erasedMasked),
  ])
}

const phoneReplacements = (phones: readonly string[], variantsOf: (phone: string) => readonly string[]): Replacement[] =>
  phones.flatMap((phone) => variantsOf(phone).map((variant) => bounded(variant, DIGITS_BEFORE, DIGITS_AFTER, ERASED_PHONE)))

export const createContactScrubber = (contacts: KnownContacts, userId: string): ContactScrubber => {
  const emails = realEmails(contacts.emails)
  const phones = realPhones(contacts.phones)
  const names = distinct(contacts.names.map((name) => name.trim()).filter((name) => name.length > 1 && name !== ERASED_NAME))
  const emailed = emailReplacements(emails, userId)
  const jsonReplacements = byLongestNeedle([...emailed, ...phoneReplacements(phones, (phone) => [phone])])
  const textReplacements = byLongestNeedle([...emailed, ...phoneReplacements(phones, phoneVariants)])
  const ownReplacements = byLongestNeedle([
    ...textReplacements,
    ...names.map((name) => bounded(name, WORD_BEFORE, WORD_AFTER, ERASED_NAME)),
  ])
  const nameSet = new Set(names)
  return {
    emails,
    phones,
    text: (value) => replaceAll(value, textReplacements),
    ownText: (value) => replaceAll(value, ownReplacements),
    json: (value) => scrubJson(value, jsonReplacements, nameSet),
    mentions: (value) => ownReplacements.some(({ pattern }) => new RegExp(pattern.source, "iu").test(value)),
  }
}
