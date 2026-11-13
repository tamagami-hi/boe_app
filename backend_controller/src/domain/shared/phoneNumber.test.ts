import { describe, expect, test } from "vitest"

import { normalizePhone } from "./phoneNumber.js"

const refusal = (raw: string): unknown => {
  try {
    normalizePhone(raw)
  } catch (error) {
    return error
  }
  return null
}

describe("phone numbers accepted for an identity", () => {
  test.each([
    ["+91987654321", "nine national digits"],
    ["+9198765432101", "eleven national digits"],
    ["+91 98765 4321", "nine digits written with spaces"],
    ["+91987654321012", "twelve national digits, still valid generic E.164"],
  ])("refuses the Indian number %s with %s", (raw) => {
    expect(refusal(raw)).toMatchObject({ code: "VALIDATION_FAILED", fields: { phone: [expect.any(String)] } })
  })

  test.each([
    ["+919876543210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["+91 (98765) 43210", "+919876543210"],
  ])("accepts the Indian number %s as %s", (raw, normalized) => {
    expect(normalizePhone(raw)).toBe(normalized)
  })

  test.each([
    ["+14155550123", "a United States number"],
    ["+447911123456", "a United Kingdom number"],
    ["+9715012345678", "a United Arab Emirates number with a different +9 prefix"],
  ])("leaves %s, %s, as generic E.164", (raw) => {
    expect(normalizePhone(raw)).toBe(raw)
  })
})
