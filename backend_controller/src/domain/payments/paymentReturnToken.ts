import { createHmac, timingSafeEqual } from "node:crypto"

const TOKEN_VERSION = "v1"
const TOKEN_PATTERN = /^v1\.([1-9][0-9]{9})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/u

const digest = (key: Buffer, value: string): string =>
  createHmac("sha256", key).update(value).digest("base64url")

const returnKey = (key: Buffer): Buffer =>
  createHmac("sha256", key).update("boe-payment-return-v1").digest()

const expirationSeconds = (expiresAt: Date): number => Math.floor(expiresAt.getTime() / 1000)

const canonicalBase64Url = (value: string): Buffer | null => {
  const decoded = Buffer.from(value, "base64url")
  return decoded.toString("base64url") === value ? decoded : null
}

export const issuePaymentReturnToken = (
  key: Buffer,
  attemptId: string,
  expiresAt: Date,
): string => {
  const scopedKey = returnKey(key)
  const expiration = expirationSeconds(expiresAt)
  const correlation = digest(scopedKey, `correlation:${attemptId}:${expiration}`)
  const payload = `${TOKEN_VERSION}.${expiration}.${correlation}`
  return `${payload}.${digest(scopedKey, `signature:${payload}`)}`
}

export const verifyPaymentReturnToken = (
  key: Buffer,
  token: string,
  now: Date,
): boolean => {
  const match = TOKEN_PATTERN.exec(token)
  if (match === null) return false
  if (canonicalBase64Url(match[2]!) === null) return false
  const expiration = Number(match[1])
  if (!Number.isSafeInteger(expiration) || expiration <= Math.floor(now.getTime() / 1000)) return false
  const payload = `${TOKEN_VERSION}.${match[1]}.${match[2]}`
  const expected = Buffer.from(digest(returnKey(key), `signature:${payload}`), "base64url")
  const supplied = canonicalBase64Url(match[3]!)
  if (supplied === null) return false
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export const buildPaymentReturnUrl = (
  baseUrl: string,
  key: Buffer,
  attemptId: string,
  expiresAt: Date,
): string => {
  const url = new URL(baseUrl)
  url.searchParams.set("token", issuePaymentReturnToken(key, attemptId, expiresAt))
  return url.toString()
}
