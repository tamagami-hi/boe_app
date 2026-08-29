import { describe, expect, it } from "vitest"

import { approvedStartUrl, signApprovedStart } from "./approvedCheckoutStart.js"

const CONFIG = {
  startUrl: "https://www.beonedge.in/pay/go",
  secret: "0123456789abcdef0123456789abcdef0123456789abcdef",
  ttlMs: 900_000,
} as const

const NOW = new Date("2026-09-01T10:00:00.000Z")
const PROVIDER = "https://mercury-t2.phonepe.com/transact/pgv3?token=a/b+c&routingKey=W"

describe("approved checkout start URL", () => {
  it("puts the payer on the approved origin, not the provider", () => {
    const url = new URL(approvedStartUrl(CONFIG, PROVIDER, NOW))

    expect(url.origin).toBe("https://www.beonedge.in")
    expect(url.pathname).toBe("/pay/go")
    expect(url.toString()).not.toContain("phonepe.com/transact")
  })

  it("round-trips the provider URL exactly, including characters that need encoding", () => {
    const url = new URL(approvedStartUrl(CONFIG, PROVIDER, NOW))
    const encoded = url.searchParams.get("u") ?? ""

    expect(Buffer.from(encoded, "base64url").toString("utf8")).toBe(PROVIDER)
  })

  it("signs the encoded target together with the expiry", () => {
    const url = new URL(approvedStartUrl(CONFIG, PROVIDER, NOW))
    const encoded = url.searchParams.get("u") ?? ""
    const expiry = url.searchParams.get("e") ?? ""

    expect(url.searchParams.get("s")).toBe(signApprovedStart(CONFIG.secret, encoded, expiry))
  })

  it("expires, so a captured link does not stay usable", () => {
    const url = new URL(approvedStartUrl(CONFIG, PROVIDER, NOW))

    expect(Number(url.searchParams.get("e"))).toBe(NOW.getTime() + 900_000)
  })

  it("produces a different signature for a different target", () => {
    const one = new URL(approvedStartUrl(CONFIG, PROVIDER, NOW)).searchParams.get("s")
    const two = new URL(approvedStartUrl(CONFIG, "https://mercury-t2.phonepe.com/other", NOW))
      .searchParams.get("s")

    expect(one).not.toBe(two)
  })

  it("produces a different signature for a different secret", () => {
    const other = { ...CONFIG, secret: "f".repeat(48) }

    expect(new URL(approvedStartUrl(CONFIG, PROVIDER, NOW)).searchParams.get("s"))
      .not.toBe(new URL(approvedStartUrl(other, PROVIDER, NOW)).searchParams.get("s"))
  })

  it("keeps any path already on the configured start URL", () => {
    const nested = { ...CONFIG, startUrl: "https://www.beonedge.in/pay/go" }

    expect(new URL(approvedStartUrl(nested, PROVIDER, NOW)).pathname).toBe("/pay/go")
  })
})
