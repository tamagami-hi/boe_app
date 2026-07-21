import { randomBytes } from "node:crypto"

import { describe, expect, test } from "vitest"

import { createSessionTokenService, parseSessionTokenKeys } from "./sessionTokens.js"

const base64 = (bytes: number): string => randomBytes(bytes).toString("base64")

const validSource = (): Record<string, string> => ({
  CRYPTO_REFRESH_TOKEN_KEY: base64(32),
  CRYPTO_REFRESH_TOKEN_KEY_VERSION: "rt1",
  CRYPTO_CSRF_TOKEN_KEY: base64(32),
  CRYPTO_CSRF_TOKEN_KEY_VERSION: "cs1",
})

describe("parseSessionTokenKeys", () => {
  test("parses valid keys and rejects short ones", () => {
    const keys = parseSessionTokenKeys(validSource())
    expect(keys.refreshKeyVersion).toBe("rt1")
    expect(keys.csrfKeyVersion).toBe("cs1")
    expect(() => parseSessionTokenKeys({ ...validSource(), CRYPTO_REFRESH_TOKEN_KEY: base64(8) })).toThrow()
  })
})

describe("session token service", () => {
  const service = createSessionTokenService(parseSessionTokenKeys(validSource()))

  test("generates refresh tokens that match their stored hash", () => {
    const refresh = service.generateRefreshToken()
    expect(refresh.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(refresh.hash).toHaveLength(32)
    expect(refresh.keyVersion).toBe("rt1")
    expect(service.matchesRefreshToken(refresh.token, refresh.hash)).toBe(true)
    expect(service.matchesRefreshToken("wrong-token", refresh.hash)).toBe(false)
  })

  test("generates CSRF tokens that match their stored hash", () => {
    const csrf = service.generateCsrfToken()
    expect(csrf.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(csrf.keyVersion).toBe("cs1")
    expect(service.matchesCsrfToken(csrf.token, csrf.hash)).toBe(true)
  })

  test("uses distinct keys for refresh and CSRF", () => {
    const service2 = createSessionTokenService(parseSessionTokenKeys(validSource()))
    const token = service2.generateRefreshToken().token
    // The same raw token hashed under the CSRF key differs from the refresh hash.
    expect(service2.hashRefreshToken(token).hash.equals(service2.hashCsrfToken(token).hash)).toBe(false)
  })
})
