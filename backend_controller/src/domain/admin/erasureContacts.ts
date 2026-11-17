import { maskEmail } from "../../crypto/primitives.js"
import { isReservedEmail, RELEASED_PHONE_PREFIX } from "../shared/reservedContacts.js"
import {
  isFreeText,
  NATIONAL_NUMBER_LENGTH,
  nationalFormsSource,
  nationalNumberOf,
  walkJsonStrings,
  type JsonEntryScrub,
} from "./erasurePhoneForms.js"

export const ERASED_NAME = "Tombstoned"
export const ERASED_PHONE = "tombstone"
export const ERASED_HISTORY_PREVIOUS_PHONE = "tombstone-previous"
export const ERASED_HISTORY_NEW_PHONE = "tombstone-new"

const ERASED_EMAIL_DOMAIN = "invalid.example"
const MIN_PHONE_DIGITS = 8
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const boundedSource = (source: string, before: string, after: string, replacement: string, length: number): Replacement => ({
  pattern: new RegExp(`${before}${source}${after}`, "giu"),
  replacement,
  length,
})

const bounded = (needle: string, before: string, after: string, replacement: string): Replacement =>
  boundedSource(escapeRegExp(needle), before, after, replacement, needle.length)

const phoneSources = (phone: string): Readonly<{ source: string; length: number }>[] => {
  const national = nationalNumberOf(phone)
  if (national !== null) return [{ source: nationalFormsSource(national), length: NATIONAL_NUMBER_LENGTH }]
  return distinct([phone, phone.replace(/^\+/u, "")])
    .filter((variant) => variant.replace(/\D/gu, "").length >= MIN_PHONE_DIGITS)
    .map((variant) => ({ source: escapeRegExp(variant), length: variant.length }))
}

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

const nomineeEntry: JsonEntryScrub = (key, item, walk) =>
  key === "nominee" && item !== null && typeof item === "object" && !Array.isArray(item)
    ? nomineeObject(item as Record<string, unknown>)
    : walk(item)

const emailReplacements = (emails: readonly string[], userId: string): Replacement[] => {
  const erasedEmail = erasedEmailFor(userId)
  const erasedMasked = maskEmail(erasedEmail)
  return emails.flatMap((email) => [
    bounded(email, EMAIL_BEFORE, EMAIL_AFTER, erasedEmail),
    bounded(maskEmail(email), EMAIL_BEFORE, EMAIL_AFTER, erasedMasked),
  ])
}

const storedPhoneReplacements = (phones: readonly string[]): Replacement[] =>
  phones.map((phone) => bounded(phone, DIGITS_BEFORE, DIGITS_AFTER, ERASED_PHONE))

const phoneReplacements = (phones: readonly string[]): Replacement[] =>
  phones.flatMap((phone) =>
    phoneSources(phone).map(({ source, length }) => boundedSource(source, DIGITS_BEFORE, DIGITS_AFTER, ERASED_PHONE, length)),
  )

export const createContactScrubber = (contacts: KnownContacts, userId: string): ContactScrubber => {
  const emails = realEmails(contacts.emails)
  const phones = realPhones(contacts.phones)
  const names = distinct(contacts.names.map((name) => name.trim()).filter((name) => name.length > 1 && name !== ERASED_NAME))
  const emailed = emailReplacements(emails, userId)
  const storedReplacements = byLongestNeedle([...emailed, ...storedPhoneReplacements(phones)])
  const textReplacements = byLongestNeedle([...emailed, ...phoneReplacements(phones)])
  const ownReplacements = byLongestNeedle([
    ...textReplacements,
    ...names.map((name) => bounded(name, WORD_BEFORE, WORD_AFTER, ERASED_NAME)),
  ])
  const nameSet = new Set(names)
  const jsonString = (value: string): string =>
    nameSet.has(value.trim())
      ? ERASED_NAME
      : replaceAll(value, isFreeText(value) ? textReplacements : storedReplacements)
  return {
    emails,
    phones,
    text: (value) => replaceAll(value, textReplacements),
    ownText: (value) => replaceAll(value, ownReplacements),
    json: (value) => walkJsonStrings(value, jsonString, nomineeEntry),
    mentions: (value) => ownReplacements.some(({ pattern }) => new RegExp(pattern.source, "iu").test(value)),
  }
}
