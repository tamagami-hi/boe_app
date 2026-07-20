import { describe, expect, test, vi } from "vitest"

import { createCertificateFetcher, isDisallowedAddress } from "./certificateFetcher.js"

describe("isDisallowedAddress", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "not-an-ip",
  ])("disallows %s", (address) => {
    expect(isDisallowedAddress(address)).toBe(true)
  })

  test.each(["52.94.1.1", "13.35.0.1", "2600:9000::1", "::ffff:52.94.1.1"])("allows public %s", (address) => {
    expect(isDisallowedAddress(address)).toBe(false)
  })
})

const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem"

describe("createCertificateFetcher", () => {
  const publicLookup = () => Promise.resolve([{ address: "52.94.1.1" }])

  test("fetches the PEM when the host resolves to a public address", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----")),
    )
    const fetcher = createCertificateFetcher({
      lookup: publicLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const result = await fetcher.fetch(CERT_URL)
    expect(result.pem).toContain("BEGIN CERTIFICATE")
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  test("rejects a host that resolves to a private address before fetching", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("x")))
    const fetcher = createCertificateFetcher({
      lookup: () => Promise.resolve([{ address: "10.0.0.5" }]),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(fetcher.fetch(CERT_URL)).rejects.toThrow(/disallowed/u)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test("rejects a non-https URL and a non-443 port", async () => {
    const fetcher = createCertificateFetcher({ lookup: publicLookup })
    await expect(fetcher.fetch("http://sns.us-east-1.amazonaws.com/a.pem")).rejects.toThrow(/https/u)
    await expect(fetcher.fetch("https://sns.us-east-1.amazonaws.com:8443/a.pem")).rejects.toThrow(/443/u)
  })

  test("rejects an unresolved host and a non-200 response", async () => {
    const empty = createCertificateFetcher({ lookup: () => Promise.resolve([]) })
    await expect(empty.fetch(CERT_URL)).rejects.toThrow(/did not resolve/u)

    const notOk = createCertificateFetcher({
      lookup: publicLookup,
      fetchImpl: (() => Promise.resolve(new Response("nope", { status: 404 }))) as unknown as typeof fetch,
    })
    await expect(notOk.fetch(CERT_URL)).rejects.toThrow(/status 404/u)
  })

  test("rejects an over-limit response body", async () => {
    const fetcher = createCertificateFetcher({
      lookup: publicLookup,
      maxBytes: 8,
      fetchImpl: (() =>
        Promise.resolve(new Response("this body is definitely longer than eight bytes"))) as unknown as typeof fetch,
    })
    await expect(fetcher.fetch(CERT_URL)).rejects.toThrow(/size limit/u)
  })
})
