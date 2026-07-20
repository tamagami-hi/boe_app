import { randomBytes } from "node:crypto"

import { describe, expect, test } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "./context.js"

const base64 = (bytes: number): string => randomBytes(bytes).toString("base64")

const validSource = (): Record<string, string> => ({
  CRYPTO_TOKEN_HASH_KEY: base64(32),
  CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
  CRYPTO_CONSENT_IP_HMAC_KEY: base64(32),
  CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
  CRYPTO_RECIPIENT_HMAC_KEY: base64(32),
  CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
  CRYPTO_RECIPIENT_ENC_KEY: base64(32),
  CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
})

describe("parseCryptoKeys", () => {
  test("parses valid base64 keys", () => {
    const keys = parseCryptoKeys(validSource())
    expect(keys.recipientEncryptionKey).toHaveLength(32)
    expect(keys.tokenHashKeyVersion).toBe("tk1")
  })

  test("rejects a non-32-byte encryption key", () => {
    expect(() => parseCryptoKeys({ ...validSource(), CRYPTO_RECIPIENT_ENC_KEY: base64(16) })).toThrow()
  })

  test("rejects a short HMAC key", () => {
    expect(() => parseCryptoKeys({ ...validSource(), CRYPTO_TOKEN_HASH_KEY: base64(8) })).toThrow()
  })
})

describe("createCryptoContext", () => {
  const context = createCryptoContext(parseCryptoKeys(validSource()))

  test("generates a token whose stored hash matches the raw token", () => {
    const generated = context.generateVerificationToken()
    expect(generated.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(generated.hash).toHaveLength(32)
    expect(context.hashToken(generated.token).hash.equals(generated.hash)).toBe(true)
    expect(generated.keyVersion).toBe("tk1")
  })

  test("produces versioned identity HMACs", () => {
    expect(context.hmacConsentIp("203.0.113.9").hash).toHaveLength(32)
    expect(context.hmacRecipient("a@example.com").keyVersion).toBe("rk1")
    expect(context.suppressionHmacKeyVersion).toBe("rk1")
  })

  test("round-trips the recipient envelope", () => {
    const envelope = context.encryptRecipient("learner@example.com")
    expect(envelope.nonce).toHaveLength(12)
    expect(envelope.keyVersion).toBe("ek1")
    expect(context.decryptRecipient(envelope.ciphertext, envelope.nonce)).toBe("learner@example.com")
  })

  test("masks an email", () => {
    expect(context.maskEmail("learner@example.com")).toBe("l***@example.com")
  })
})
