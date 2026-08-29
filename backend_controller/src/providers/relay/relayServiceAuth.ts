import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"

export const SERVICE_HEADER = "x-boe-service"
export const TIMESTAMP_HEADER = "x-boe-timestamp"
export const NONCE_HEADER = "x-boe-nonce"
export const SIGNATURE_HEADER = "x-boe-signature"

export const signingString = (
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  rawBody: string,
): string =>
  [
    method.toUpperCase(),
    path,
    timestamp,
    nonce,
    createHash("sha256").update(rawBody, "utf8").digest("hex"),
  ].join("\n")

export const signRelayRequest = (
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  rawBody: string,
): string =>
  createHmac("sha256", secret)
    .update(signingString(method, path, timestamp, nonce, rawBody), "utf8")
    .digest("hex")

export type RelayHeaders = Readonly<Record<string, string>>

export const relayRequestHeaders = (
  deps: Readonly<{ service: string; secret: string; now: () => Date; nonce?: () => string }>,
  method: string,
  path: string,
  rawBody: string,
): RelayHeaders => {
  const timestamp = String(deps.now().getTime())
  const nonce = (deps.nonce ?? randomUUID)()
  return Object.freeze({
    "content-type": "application/json",
    [SERVICE_HEADER]: deps.service,
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: signRelayRequest(deps.secret, method, path, timestamp, nonce, rawBody),
  })
}

export type EventAuthResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "missing-headers" | "stale-timestamp" | "bad-signature" }>

const constantTimeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export const verifyRelayEvent = (
  deps: Readonly<{ secret: string; windowSeconds: number; now: Date }>,
  method: string,
  path: string,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  rawBody: string,
): EventAuthResult => {
  const read = (name: string): string | null => {
    const value = headers[name]
    return typeof value === "string" && value.length > 0 ? value : null
  }
  const timestamp = read(TIMESTAMP_HEADER)
  const nonce = read(NONCE_HEADER)
  const signature = read(SIGNATURE_HEADER)
  if (timestamp === null || nonce === null || signature === null) {
    return { ok: false, reason: "missing-headers" }
  }
  const at = Number(timestamp)
  if (!Number.isFinite(at)) return { ok: false, reason: "stale-timestamp" }
  if (Math.abs(deps.now.getTime() - at) > deps.windowSeconds * 1_000) {
    return { ok: false, reason: "stale-timestamp" }
  }
  const expected = signRelayRequest(deps.secret, method, path, timestamp, nonce, rawBody)
  if (!constantTimeEqual(expected, signature)) return { ok: false, reason: "bad-signature" }
  return { ok: true }
}
