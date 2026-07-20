/**
 * Authenticated opaque pagination cursor (spec 04 §3.2). A cursor encodes the
 * sort values, the route, a hash of the active filters, and a 24-hour expiry,
 * signed with HMAC-SHA-256. Decoding fails closed (`CURSOR_INVALID`) on a bad
 * signature, an expired cursor, or a route/filter mismatch, so a cursor can
 * never be replayed against a different route or changed filters.
 */
import { createHash } from "node:crypto"

import { bytesEqual, hmacSha256 } from "../crypto/primitives.js"
import { AppError } from "./errorCatalog.js"

export const CURSOR_TTL_MS = 24 * 60 * 60 * 1000

interface CursorPayload {
  readonly r: string
  readonly f: string
  readonly v: readonly string[]
  readonly e: number
}

/** Stable SHA-256 hex of the active filter set; binds a cursor to its filters. */
export const computeFilterHash = (filters: Readonly<Record<string, unknown>>): string => {
  const canonical = JSON.stringify(
    Object.keys(filters)
      .sort()
      .map((key) => [key, filters[key] ?? null]),
  )
  return createHash("sha256").update(canonical).digest("hex")
}

const toBase64Url = (value: string): string => Buffer.from(value, "utf8").toString("base64url")
const fromBase64Url = (value: string): string => Buffer.from(value, "base64url").toString("utf8")

export interface EncodeCursorInput {
  readonly route: string
  readonly filterHash: string
  readonly sortValues: readonly string[]
  readonly now: Date
}

/** Encode and sign an opaque cursor for the given sort position. */
export const encodeCursor = (key: Buffer, input: EncodeCursorInput): string => {
  const payload: CursorPayload = {
    r: input.route,
    f: input.filterHash,
    v: input.sortValues,
    e: input.now.getTime() + CURSOR_TTL_MS,
  }
  const body = toBase64Url(JSON.stringify(payload))
  const signature = hmacSha256(key, body).toString("base64url")
  return `${body}.${signature}`
}

export interface DecodeCursorInput {
  readonly route: string
  readonly filterHash: string
  readonly now: Date
}

/**
 * Verify and decode a cursor, returning its sort values. Throws
 * `CURSOR_INVALID` on any signature/expiry/route/filter failure.
 */
export const decodeCursor = (key: Buffer, token: string, expected: DecodeCursorInput): readonly string[] => {
  const separator = token.lastIndexOf(".")
  if (separator <= 0) throw new AppError("CURSOR_INVALID")
  const body = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  const expectedSignature = hmacSha256(key, body)
  let presentedSignature: Buffer
  try {
    presentedSignature = Buffer.from(signature, "base64url")
  } catch {
    throw new AppError("CURSOR_INVALID")
  }
  if (!bytesEqual(expectedSignature, presentedSignature)) throw new AppError("CURSOR_INVALID")

  let payload: CursorPayload
  try {
    payload = JSON.parse(fromBase64Url(body)) as CursorPayload
  } catch {
    throw new AppError("CURSOR_INVALID")
  }
  if (
    typeof payload !== "object" ||
    payload.r !== expected.route ||
    payload.f !== expected.filterHash ||
    !Array.isArray(payload.v) ||
    typeof payload.e !== "number" ||
    payload.e <= expected.now.getTime()
  ) {
    throw new AppError("CURSOR_INVALID")
  }
  return payload.v.map((value) => String(value))
}
