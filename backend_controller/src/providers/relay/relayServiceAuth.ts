import { createHash, createHmac, randomUUID } from "node:crypto"

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
