import { randomBytes } from "node:crypto"

import { describe, expect, test } from "vitest"

import {
  bytesEqual,
  decryptGcm,
  encryptGcm,
  generateOpaqueToken,
  hmacSha256,
  maskEmail,
} from "./primitives.js"

const KEY = randomBytes(32)

describe("opaque tokens", () => {
  test("match the verify-email contract and are unique", () => {
    const first = generateOpaqueToken()
    const second = generateOpaqueToken()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first).not.toBe(second)
  })
})

describe("hmacSha256", () => {
  test("is deterministic and 32 bytes", () => {
    const a = hmacSha256(KEY, "value")
    const b = hmacSha256(KEY, "value")
    expect(a).toHaveLength(32)
    expect(bytesEqual(a, b)).toBe(true)
    expect(bytesEqual(a, hmacSha256(KEY, "other"))).toBe(false)
  })
})

describe("AES-256-GCM envelope", () => {
  test("round-trips with a 12-byte nonce and tagged ciphertext", () => {
    const { ciphertext, nonce } = encryptGcm(KEY, "learner@example.com")
    expect(nonce).toHaveLength(12)
    expect(ciphertext.length).toBeGreaterThanOrEqual(16)
    expect(decryptGcm(KEY, ciphertext, nonce)).toBe("learner@example.com")
  })

  test("fails to decrypt when the ciphertext is tampered", () => {
    const { ciphertext, nonce } = encryptGcm(KEY, "learner@example.com")
    const tampered = Buffer.from(ciphertext)
    tampered[0] = (tampered[0] ?? 0) ^ 0xff
    expect(() => decryptGcm(KEY, tampered, nonce)).toThrow()
  })

  test("rejects a non-32-byte key", () => {
    expect(() => encryptGcm(randomBytes(16), "x")).toThrow()
  })
})

describe("maskEmail", () => {
  test("hides the local part and full domain", () => {
    const masked = maskEmail("learner@example.com")
    expect(masked).toBe("l***@e***")
    expect(masked).not.toContain("earner")
    expect(masked).not.toMatch(/@[^@]+\.[^@]+$/u)
  })

  test("returns a safe placeholder for a malformed address", () => {
    expect(maskEmail("not-an-email")).toBe("***")
  })
})
