import { describe, expect, test } from "vitest"

import { hashPassword, passwordInputSchema, verifyDummyPassword, verifyPassword } from "./passwordHasher.js"

describe("passwordInputSchema", () => {
  test("accepts a valid password and rejects short or control-character input", () => {
    expect(passwordInputSchema.safeParse("correct horse battery").success).toBe(true)
    expect(passwordInputSchema.safeParse("short").success).toBe(false)
    expect(passwordInputSchema.safeParse("valid-length\u0007bell").success).toBe(false)
  })
})

describe("Argon2id password hashing", () => {
  test("hashes to an encoded argon2id string and verifies correctly", async () => {
    const encoded = await hashPassword("correct horse battery staple")
    expect(encoded.startsWith("$argon2id$")).toBe(true)
    expect(await verifyPassword(encoded, "correct horse battery staple")).toBe(true)
    expect(await verifyPassword(encoded, "wrong password entirely")).toBe(false)
  })

  test("dummy verification always resolves false", async () => {
    expect(await verifyDummyPassword("anything")).toBe(false)
  })
})
