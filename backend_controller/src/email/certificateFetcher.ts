/**
 * SSRF-hardened Amazon SNS signing-certificate fetcher (spec 04 §6.3). Resolves
 * the host and rejects any private/loopback/link-local/multicast address before
 * issuing a single HTTPS GET with no redirects, a bounded timeout, and a size
 * cap. The route validates the certificate URL host/scheme/path first
 * (`validateSigningCertUrl`); this adapter is defense-in-depth on the transport.
 * DNS lookup and the HTTPS fetch are injectable so the guard logic is testable
 * without network access.
 */
import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"

import type { CertificateFetcher, FetchedCertificate } from "./ports.js"

const DEFAULT_MAX_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 3_000

const parseOctets = (address: string): readonly number[] | null => {
  const parts = address.split(".")
  if (parts.length !== 4) return null
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return octets
}

/**
 * True when an IP literal is in a range a public SNS endpoint must never resolve
 * to (loopback, private, link-local, CGNAT, unspecified, multicast/reserved, or
 * an IPv4-mapped IPv6 form thereof). A non-IP input is disallowed because callers
 * resolve to addresses first.
 */
export const isDisallowedAddress = (address: string): boolean => {
  const family = isIP(address)
  if (family === 4) {
    const octets = parseOctets(address)
    if (octets === null) return true
    const [a = 0, b = 0] = octets
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }
  if (family === 6) {
    const ip = address.toLowerCase()
    if (ip === "::1" || ip === "::") return true
    if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) return true
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true
    if (ip.startsWith("ff")) return true
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/u.exec(ip)
    if (mapped?.[1] !== undefined) return isDisallowedAddress(mapped[1])
    return false
  }
  return true
}

export interface CertificateFetcherOptions {
  readonly lookup?: (hostname: string) => Promise<readonly { readonly address: string }[]>
  readonly fetchImpl?: typeof fetch
  readonly maxBytes?: number
  readonly timeoutMs?: number
}

export const createCertificateFetcher = (options: CertificateFetcherOptions = {}): CertificateFetcher => {
  const lookup = options.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true }))
  const fetchImpl = options.fetchImpl ?? fetch
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    fetch: async (certificateUrl: string): Promise<FetchedCertificate> => {
      const url = new URL(certificateUrl)
      if (url.protocol !== "https:") throw new Error("certificate URL must be https")
      if (url.port !== "" && url.port !== "443") throw new Error("certificate URL must use port 443")

      const addresses = await lookup(url.hostname)
      if (addresses.length === 0) throw new Error("certificate host did not resolve")
      for (const { address } of addresses) {
        if (isDisallowedAddress(address)) throw new Error("certificate host resolves to a disallowed address")
      }

      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`certificate fetch failed with status ${String(response.status)}`)
      const body = await response.text()
      if (Buffer.byteLength(body, "utf8") > maxBytes) throw new Error("certificate response exceeded the size limit")
      return { pem: body }
    },
  }
}
