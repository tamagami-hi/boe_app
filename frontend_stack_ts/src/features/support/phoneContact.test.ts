import { describe, expect, it } from "vitest"

import type { LegalContact } from "~/features/legal/publishedContent"

import { isPhoneContact } from "./phoneContact"

const contact = (label: string, value: string, href: string | null = null): LegalContact => ({
  label,
  value,
  href,
})

describe("the Support page keeps phone numbers off the screen", () => {
  it.each([
    ["a tel: link", contact("Support", "1800 123 4567", "tel:18001234567")],
    ["an sms: link", contact("Support", "Text us", "sms:+919876543210")],
    ["a wa.me link", contact("Support", "Message us", "https://wa.me/919876543210")],
    ["an api.whatsapp.com link", contact("Support", "Message us", "https://api.whatsapp.com/send?phone=919876543210")],
    ["a Telephone label", contact("Telephone", "On request")],
    ["an upper-case HELPLINE label", contact("HELPLINE", "On request")],
    ["a WhatsApp label", contact("WhatsApp", "On request")],
    ["a Mobile number label", contact("Mobile number", "On request")],
    ["a Call us label", contact("Call us", "On request")],
    ["a Tel. label", contact("Tel.", "On request")],
    ["a number the parser could not link", contact("Support", "(022) 2345 6789")],
    ["a number inside words", contact("Support", "Call 1800 123 4567 on weekdays")],
    ["an international number with a note", contact("Support", "+91 98765 43210 (Mon-Fri)")],
    ["a dotted international number", contact("Support", "+91.98765.43210")],
    ["ten digits in a row", contact("Support", "9876543210")],
  ])("hides %s", (_case, entry) => {
    expect(isPhoneContact(entry)).toBe(true)
  })

  it.each([
    ["an email", contact("Email", "help@example.com", "mailto:help@example.com")],
    ["one range of hours", contact("Hours", "10.00 - 18.00")],
    ["two ranges of hours", contact("Hours", "9.00-18.00 10.00-14.00")],
    ["an address with a PIN code", contact("Address", "Plot 12, Bhubaneswar 751024")],
    ["a name", contact("Name", "Grievance officer")],
    ["a website", contact("Website", "https://example.com", "https://example.com")],
  ])("keeps %s", (_case, entry) => {
    expect(isPhoneContact(entry)).toBe(false)
  })
})
