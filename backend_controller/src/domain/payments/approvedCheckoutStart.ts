import { createHmac } from "node:crypto"

export interface ApprovedStartConfig {
  readonly startUrl: string
  readonly secret: string
  readonly ttlMs: number
}

export const signApprovedStart = (
  secret: string,
  encodedTarget: string,
  expiry: string,
): string =>
  createHmac("sha256", secret).update(`${encodedTarget}\n${expiry}`, "utf8").digest("hex")

export const approvedStartUrl = (
  config: ApprovedStartConfig,
  providerCheckoutUrl: string,
  now: Date,
): string => {
  const encoded = Buffer.from(providerCheckoutUrl, "utf8").toString("base64url")
  const expiry = String(now.getTime() + config.ttlMs)
  const url = new URL(config.startUrl)
  url.searchParams.set("u", encoded)
  url.searchParams.set("e", expiry)
  url.searchParams.set("s", signApprovedStart(config.secret, encoded, expiry))
  return url.toString()
}
