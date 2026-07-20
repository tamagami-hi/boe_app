/**
 * Typed crypto key configuration and the bound `CryptoContext` the onboarding
 * routes and email worker consume. Keys are base64-encoded secrets supplied by
 * the environment; this module decodes and length-validates them and binds them
 * to the primitives. Key material is never logged or serialized.
 */
import { z } from "zod"

import {
  decryptGcm,
  encryptGcm,
  generateOpaqueToken,
  hmacSha256,
  maskEmail,
} from "./primitives.js"

const HMAC_MIN_KEY_BYTES = 32
const AES_256_KEY_BYTES = 32

const decodeBase64 = (value: string): Buffer => Buffer.from(value, "base64")

const KeyConfigSchema = z.object({
  CRYPTO_TOKEN_HASH_KEY: z.string().trim().min(1),
  CRYPTO_TOKEN_HASH_KEY_VERSION: z.string().trim().min(1),
  CRYPTO_CONSENT_IP_HMAC_KEY: z.string().trim().min(1),
  CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: z.string().trim().min(1),
  CRYPTO_RECIPIENT_HMAC_KEY: z.string().trim().min(1),
  CRYPTO_RECIPIENT_HMAC_KEY_VERSION: z.string().trim().min(1),
  CRYPTO_RECIPIENT_ENC_KEY: z.string().trim().min(1),
  CRYPTO_RECIPIENT_ENC_KEY_VERSION: z.string().trim().min(1),
})

export interface CryptoKeys {
  readonly tokenHashKey: Buffer
  readonly tokenHashKeyVersion: string
  readonly consentIpHmacKey: Buffer
  readonly consentIpHmacKeyVersion: string
  readonly recipientHmacKey: Buffer
  readonly recipientHmacKeyVersion: string
  readonly recipientEncryptionKey: Buffer
  readonly recipientEncryptionKeyVersion: string
}

const requireHmacKey = (buffer: Buffer, name: string): Buffer => {
  if (buffer.length < HMAC_MIN_KEY_BYTES) {
    throw new Error(`${name} must decode to at least ${String(HMAC_MIN_KEY_BYTES)} bytes`)
  }
  return buffer
}

/** Parse and length-validate the crypto keys from an environment source. */
export const parseCryptoKeys = (source: Readonly<Record<string, string | undefined>>): CryptoKeys => {
  const parsed = KeyConfigSchema.parse(source)
  const recipientEncryptionKey = decodeBase64(parsed.CRYPTO_RECIPIENT_ENC_KEY)
  if (recipientEncryptionKey.length !== AES_256_KEY_BYTES) {
    throw new Error(`CRYPTO_RECIPIENT_ENC_KEY must decode to exactly ${String(AES_256_KEY_BYTES)} bytes`)
  }
  return Object.freeze({
    tokenHashKey: requireHmacKey(decodeBase64(parsed.CRYPTO_TOKEN_HASH_KEY), "CRYPTO_TOKEN_HASH_KEY"),
    tokenHashKeyVersion: parsed.CRYPTO_TOKEN_HASH_KEY_VERSION,
    consentIpHmacKey: requireHmacKey(decodeBase64(parsed.CRYPTO_CONSENT_IP_HMAC_KEY), "CRYPTO_CONSENT_IP_HMAC_KEY"),
    consentIpHmacKeyVersion: parsed.CRYPTO_CONSENT_IP_HMAC_KEY_VERSION,
    recipientHmacKey: requireHmacKey(decodeBase64(parsed.CRYPTO_RECIPIENT_HMAC_KEY), "CRYPTO_RECIPIENT_HMAC_KEY"),
    recipientHmacKeyVersion: parsed.CRYPTO_RECIPIENT_HMAC_KEY_VERSION,
    recipientEncryptionKey,
    recipientEncryptionKeyVersion: parsed.CRYPTO_RECIPIENT_ENC_KEY_VERSION,
  })
}

export interface KeyedHash {
  readonly hash: Buffer
  readonly keyVersion: string
}

export interface KeyedEnvelope {
  readonly ciphertext: Buffer
  readonly nonce: Buffer
  readonly keyVersion: string
}

export interface GeneratedToken {
  readonly token: string
  readonly hash: Buffer
  readonly keyVersion: string
}

export interface CryptoContext {
  generateVerificationToken: () => GeneratedToken
  hashToken: (rawToken: string) => KeyedHash
  hmacConsentIp: (canonicalIp: string) => KeyedHash
  hmacRecipient: (emailNormalized: string) => KeyedHash
  encryptRecipient: (emailNormalized: string) => KeyedEnvelope
  decryptRecipient: (ciphertext: Buffer, nonce: Buffer) => string
  maskEmail: (email: string) => string
  readonly suppressionHmacKeyVersion: string
  readonly recipientEncryptionKeyVersion: string
}

/** Bind the crypto keys to the primitives the onboarding surface consumes. */
export const createCryptoContext = (keys: CryptoKeys): CryptoContext => {
  const hashToken = (rawToken: string): KeyedHash => ({
    hash: hmacSha256(keys.tokenHashKey, rawToken),
    keyVersion: keys.tokenHashKeyVersion,
  })

  return Object.freeze({
    generateVerificationToken: (): GeneratedToken => {
      const token = generateOpaqueToken()
      return { token, hash: hashToken(token).hash, keyVersion: keys.tokenHashKeyVersion }
    },
    hashToken,
    hmacConsentIp: (canonicalIp: string): KeyedHash => ({
      hash: hmacSha256(keys.consentIpHmacKey, canonicalIp),
      keyVersion: keys.consentIpHmacKeyVersion,
    }),
    hmacRecipient: (emailNormalized: string): KeyedHash => ({
      hash: hmacSha256(keys.recipientHmacKey, emailNormalized),
      keyVersion: keys.recipientHmacKeyVersion,
    }),
    encryptRecipient: (emailNormalized: string): KeyedEnvelope => {
      const envelope = encryptGcm(keys.recipientEncryptionKey, emailNormalized)
      return { ...envelope, keyVersion: keys.recipientEncryptionKeyVersion }
    },
    decryptRecipient: (ciphertext: Buffer, nonce: Buffer): string =>
      decryptGcm(keys.recipientEncryptionKey, ciphertext, nonce),
    maskEmail,
    suppressionHmacKeyVersion: keys.recipientHmacKeyVersion,
    recipientEncryptionKeyVersion: keys.recipientEncryptionKeyVersion,
  })
}
