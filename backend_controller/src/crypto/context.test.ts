import { randomBytes } from "node:crypto"

import { describe, expect, test } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "./context.js"
import { encryptGcm } from "./primitives.js"

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

describe("delivery payload envelope", () => {
  const source = validSource()
  const context = createCryptoContext(parseCryptoKeys(source))
  const SECRET = "secret-token-9f2c"
  const payload = { downloadUrl: `https://downloads.test/${SECRET}/boe.apk` }
  const key = Buffer.from(source.CRYPTO_RECIPIENT_ENC_KEY ?? "", "base64")
  const aadFor = (deliveryId: string): Buffer => Buffer.from(`boe.email-delivery-payload.v1:${deliveryId}`, "utf8")

  test("round-trips under its delivery id and stores nothing readable", () => {
    const sealed = context.encryptDeliveryPayload("delivery-1", payload)

    expect(sealed.nonce).toHaveLength(12)
    expect(sealed.keyVersion).toBe("ek1")
    expect(sealed.ciphertext.includes(Buffer.from(SECRET))).toBe(false)
    expect(context.decryptDeliveryPayload("delivery-1", sealed)).toEqual({ kind: "opened", payload })
  })

  test("a ciphertext moved to another delivery, or swapped with the recipient envelope, is unreadable", () => {
    const sealed = context.encryptDeliveryPayload("delivery-1", payload)
    const recipient = context.encryptRecipient("learner@example.com")

    expect(context.decryptDeliveryPayload("delivery-2", sealed)).toEqual({ kind: "unreadable" })
    expect(context.decryptDeliveryPayload("delivery-1", recipient)).toEqual({ kind: "unreadable" })
    expect(() => context.decryptRecipient(sealed.ciphertext, sealed.nonce)).toThrow()
  })

  test("a different key version is a key mismatch and a tampered ciphertext is unreadable", () => {
    const sealed = context.encryptDeliveryPayload("delivery-1", payload)
    const tampered = Buffer.from(sealed.ciphertext)
    tampered[0] = (tampered[0] ?? 0) ^ 0xff

    expect(context.decryptDeliveryPayload("delivery-1", { ...sealed, keyVersion: "ek0" })).toEqual({
      kind: "key_version_mismatch",
    })
    expect(context.decryptDeliveryPayload("delivery-1", { ...sealed, ciphertext: tampered })).toEqual({
      kind: "unreadable",
    })
  })

  test("opens an envelope built independently with the documented AAD and refuses a non-object body", () => {
    const independent = encryptGcm(key, JSON.stringify(payload), aadFor("delivery-1"))
    const notAnObject = encryptGcm(key, "[1,2]", aadFor("delivery-1"))

    expect(context.decryptDeliveryPayload("delivery-1", { ...independent, keyVersion: "ek1" })).toEqual({
      kind: "opened",
      payload,
    })
    expect(context.decryptDeliveryPayload("delivery-1", { ...notAnObject, keyVersion: "ek1" })).toEqual({
      kind: "unreadable",
    })
  })
})
