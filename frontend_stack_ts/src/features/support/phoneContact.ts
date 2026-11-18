import type { LegalContact } from "~/features/legal/publishedContent"

const PHONE_SCHEMES = /^(?:tel|sms):/iu

const WHATSAPP_LINK = /^https:\/\/(?:wa\.me|api\.whatsapp\.com)(?:[/?#]|$)/iu

const PHONE_LABEL = /\b(?:phone|telephone|tel|mobile|helpline|whatsapp|call)\b/iu

const NUMBER_RUN = /\+?[0-9][0-9 ().-]*[0-9]/gu

const LONG_DIGIT_RUN = /[0-9]{10,}/u

const MIN_PHONE_DIGITS = 10

const digitCount = (text: string): number => text.replace(/[^0-9]/gu, "").length

const isTimeRanges = (run: string): boolean =>
  !run.includes("+") && run.includes(".") && !LONG_DIGIT_RUN.test(run)

const isPhoneNumber = (run: string): boolean =>
  digitCount(run) >= MIN_PHONE_DIGITS && !isTimeRanges(run)

const hasPhoneLink = (href: string | null): boolean =>
  href !== null && (PHONE_SCHEMES.test(href) || WHATSAPP_LINK.test(href))

export const isPhoneContact = (contact: LegalContact): boolean =>
  hasPhoneLink(contact.href) ||
  PHONE_LABEL.test(contact.label) ||
  (contact.value.match(NUMBER_RUN) ?? []).some(isPhoneNumber)
