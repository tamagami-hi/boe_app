/**
 * Opaque session-token primitives (spec 04 §4.1). Refresh and synchronizer-CSRF
 * tokens are high-entropy opaque strings; only their keyed HMAC-SHA-256 hashes
 * are stored (`auth_sessions`/`auth_refresh_tokens` carry the versioned key). The
 * raw values live only in a cookie / native secure storage / browser memory.
 *
 * The rotation state machine (previous-pair grace, family revocation) is the
 * session command layer (BE-010); this module owns only generation, hashing, and
 * constant-time verification.
 */
import { z } from "zod"

import { bytesEqual, generateOpaqueToken, hmacSha256 } from "../crypto/primitives.js"

const HMAC_MIN_KEY_BYTES = 32

export interface SessionTokenKeys {
  readonly refreshKey: Buffer
  readonly refreshKeyVersion: string
  readonly csrfKey: Buffer
  readonly csrfKeyVersion: string
}

const KeyConfigSchema = z.object({
  CRYPTO_REFRESH_TOKEN_KEY: z.string().trim().min(1),
  CRYPTO_REFRESH_TOKEN_KEY_VERSION: z.string().trim().min(1),
  CRYPTO_CSRF_TOKEN_KEY: z.string().trim().min(1),
  CRYPTO_CSRF_TOKEN_KEY_VERSION: z.string().trim().min(1),
})

const requireHmacKey = (value: string, name: string): Buffer => {
  const buffer = Buffer.from(value, "base64")
  if (buffer.length < HMAC_MIN_KEY_BYTES) {
    throw new Error(`${name} must decode to at least ${String(HMAC_MIN_KEY_BYTES)} bytes`)
  }
  return buffer
}

export const parseSessionTokenKeys = (
  source: Readonly<Record<string, string | undefined>>,
): SessionTokenKeys => {
  const parsed = KeyConfigSchema.parse(source)
  return Object.freeze({
    refreshKey: requireHmacKey(parsed.CRYPTO_REFRESH_TOKEN_KEY, "CRYPTO_REFRESH_TOKEN_KEY"),
    refreshKeyVersion: parsed.CRYPTO_REFRESH_TOKEN_KEY_VERSION,
    csrfKey: requireHmacKey(parsed.CRYPTO_CSRF_TOKEN_KEY, "CRYPTO_CSRF_TOKEN_KEY"),
    csrfKeyVersion: parsed.CRYPTO_CSRF_TOKEN_KEY_VERSION,
  })
}

export interface HashedToken {
  readonly token: string
  readonly hash: Buffer
  readonly keyVersion: string
}

export interface KeyedHash {
  readonly hash: Buffer
  readonly keyVersion: string
}

export interface SessionTokenService {
  generateRefreshToken: () => HashedToken
  hashRefreshToken: (rawToken: string) => KeyedHash
  matchesRefreshToken: (rawToken: string, storedHash: Buffer) => boolean
  generateCsrfToken: () => HashedToken
  hashCsrfToken: (rawToken: string) => KeyedHash
  matchesCsrfToken: (rawToken: string, storedHash: Buffer) => boolean
}

export const createSessionTokenService = (keys: SessionTokenKeys): SessionTokenService => {
  const hashRefreshToken = (rawToken: string): KeyedHash => ({
    hash: hmacSha256(keys.refreshKey, rawToken),
    keyVersion: keys.refreshKeyVersion,
  })
  const hashCsrfToken = (rawToken: string): KeyedHash => ({
    hash: hmacSha256(keys.csrfKey, rawToken),
    keyVersion: keys.csrfKeyVersion,
  })

  return Object.freeze({
    generateRefreshToken: (): HashedToken => {
      const token = generateOpaqueToken()
      return { token, hash: hashRefreshToken(token).hash, keyVersion: keys.refreshKeyVersion }
    },
    hashRefreshToken,
    matchesRefreshToken: (rawToken: string, storedHash: Buffer): boolean =>
      bytesEqual(hashRefreshToken(rawToken).hash, storedHash),
    generateCsrfToken: (): HashedToken => {
      const token = generateOpaqueToken()
      return { token, hash: hashCsrfToken(token).hash, keyVersion: keys.csrfKeyVersion }
    },
    hashCsrfToken,
    matchesCsrfToken: (rawToken: string, storedHash: Buffer): boolean =>
      bytesEqual(hashCsrfToken(rawToken).hash, storedHash),
  })
}
