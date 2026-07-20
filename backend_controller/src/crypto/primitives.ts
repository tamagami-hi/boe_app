/**
 * Onboarding cryptographic primitives (spec 03 §3.3/§1, 04 §3.1). Pure
 * `node:crypto` helpers with no key material of their own — callers pass keys.
 *
 * - Opaque tokens are 32 random bytes encoded base64url (43 chars) so the raw
 *   token matches the verify-email contract and is never persisted; only its
 *   peppered hash is stored.
 * - Token hashes and identity HMACs are HMAC-SHA-256 (32 bytes).
 * - Recipient envelopes are AES-256-GCM with a random 12-byte nonce; the 16-byte
 *   authentication tag is appended to the ciphertext (matching the >=16-byte
 *   bytea CHECK and the 12-byte nonce CHECK).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const TOKEN_BYTES = 32
const GCM_NONCE_BYTES = 12
const GCM_TAG_BYTES = 16
const AES_256_KEY_BYTES = 32

/** Generate a high-entropy opaque token (43-char base64url). */
export const generateOpaqueToken = (): string => randomBytes(TOKEN_BYTES).toString("base64url")

/** HMAC-SHA-256 of `data` under `key`, returned as a 32-byte Buffer. */
export const hmacSha256 = (key: Buffer, data: string | Buffer): Buffer =>
  createHmac("sha256", key).update(data).digest()

/** Constant-time comparison of two byte buffers. */
export const bytesEqual = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right)

export interface EncryptedEnvelope {
  readonly ciphertext: Buffer
  readonly nonce: Buffer
}

/**
 * AES-256-GCM encrypt `plaintext`. The returned ciphertext is the GCM output
 * with the 16-byte authentication tag appended; the nonce is a fresh 12 bytes.
 */
export const encryptGcm = (key: Buffer, plaintext: string): EncryptedEnvelope => {
  if (key.length !== AES_256_KEY_BYTES) {
    throw new Error("AES-256-GCM requires a 32-byte key")
  }
  const nonce = randomBytes(GCM_NONCE_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return { ciphertext: Buffer.concat([encrypted, tag]), nonce }
}

/** AES-256-GCM decrypt an envelope produced by {@link encryptGcm}. */
export const decryptGcm = (key: Buffer, ciphertext: Buffer, nonce: Buffer): string => {
  if (key.length !== AES_256_KEY_BYTES) {
    throw new Error("AES-256-GCM requires a 32-byte key")
  }
  if (ciphertext.length < GCM_TAG_BYTES) {
    throw new Error("ciphertext is too short to contain an authentication tag")
  }
  const tag = ciphertext.subarray(ciphertext.length - GCM_TAG_BYTES)
  const encrypted = ciphertext.subarray(0, ciphertext.length - GCM_TAG_BYTES)
  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}

/**
 * Mask an email per the `MaskedEmail` contract (spec 04 §2.1): reveal exactly the
 * first Unicode scalar of the local part, then `***@`, then the complete
 * lowercase domain. The local part is hidden so the result is never a complete
 * address; the domain is retained.
 */
export const maskEmail = (email: string): string => {
  const atIndex = email.lastIndexOf("@")
  if (atIndex <= 0 || atIndex === email.length - 1) return "***"
  const local = email.slice(0, atIndex)
  const domain = email.slice(atIndex + 1).toLowerCase()
  const firstScalar = [...local][0] ?? ""
  return `${firstScalar}***@${domain}`
}
