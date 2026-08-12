import { describe, expect, test } from "vitest"

import { normalizeIpAddress, sanitizeUserAgent } from "./requestProvenance.js"

describe("normalizeIpAddress", () => {
  test("accepts IPv4 and IPv6, including the IPv4-mapped form", () => {
    expect(normalizeIpAddress("203.0.113.7")).toBe("203.0.113.7")
    expect(normalizeIpAddress("2001:db8::1")).toBe("2001:db8::1")
    expect(normalizeIpAddress("::ffff:127.0.0.1")).toBe("::ffff:127.0.0.1")
    expect(normalizeIpAddress("  203.0.113.7  ")).toBe("203.0.113.7")
  })

  test("rejects anything the inet column would refuse", () => {
    // A forwarding header is attacker-controlled; an unstorable value must become
    // null rather than fail the INSERT it is part of.
    expect(normalizeIpAddress("unknown")).toBeNull()
    expect(normalizeIpAddress("203.0.113.999")).toBeNull()
    expect(normalizeIpAddress("203.0.113")).toBeNull()
    expect(normalizeIpAddress("'; drop table users; --")).toBeNull()
    expect(normalizeIpAddress("")).toBeNull()
    expect(normalizeIpAddress(undefined)).toBeNull()
    expect(normalizeIpAddress("1".repeat(46))).toBeNull()
  })

  test("rejects malformed IPv6 and leading-zero IPv4, which a regex let through", () => {
    // Each of these satisfied the previous hand-rolled pattern and would have
    // failed the inet cast — inside the transaction that issues the session.
    expect(normalizeIpAddress(":::")).toBeNull()
    expect(normalizeIpAddress("1.2.3.4:80")).toBeNull()
    expect(normalizeIpAddress("1:2:3:4:5:6:7:8:9")).toBeNull()
    expect(normalizeIpAddress("::ffff:999.1.1.1")).toBeNull()
    expect(normalizeIpAddress("2001:db8::1::2")).toBeNull()
    // PostgreSQL 16 refuses leading zeros in inet input.
    expect(normalizeIpAddress("01.2.3.4")).toBeNull()
  })
})

describe("sanitizeUserAgent", () => {
  test("keeps a normal User-Agent unchanged", () => {
    expect(sanitizeUserAgent("BeOnEdge/1.2.3 (Android 14; Pixel 7)")).toBe(
      "BeOnEdge/1.2.3 (Android 14; Pixel 7)",
    )
  })

  test("strips control characters, which the column CHECK rejects", () => {
    expect(sanitizeUserAgent("agent\u0000\u001bx")).toBe("agent  x")
    expect(sanitizeUserAgent("line\nbreak")).toBe("line break")
    expect(sanitizeUserAgent("\u0000\u0001")).toBeNull()
  })

  test("bounds the value to 512 bytes without splitting a character", () => {
    const bounded = sanitizeUserAgent("é".repeat(400))
    expect(bounded).not.toBeNull()
    expect(Buffer.byteLength(bounded ?? "", "utf8")).toBeLessThanOrEqual(512)
    // 2 bytes per character, so the bound must land on a character boundary.
    expect([...(bounded ?? "")].every((character) => character === "é")).toBe(true)
  })

  test("treats a blank or absent header as no user agent", () => {
    expect(sanitizeUserAgent("   ")).toBeNull()
    expect(sanitizeUserAgent(undefined)).toBeNull()
  })
})
