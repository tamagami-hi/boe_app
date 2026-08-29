import { z } from "zod"
import { describe, expect, it } from "vitest"

import * as Contracts from "./index.js"
import {
  Cursor,
  Decimal24x8,
  Decimal30x12,
  EmailInput,
  FullName,
  IdempotencyKey,
  IsoDateTime,
  MaskedEmail,
  Paise,
  PasswordInput,
  PhoneInput,
  ReasonCode,
  ReasonDetail,
  Uuid,
  VersionTag,
} from "./scalars.js"

const expectAccepted = (schema: { safeParse: (value: unknown) => { success: boolean } }, values: readonly unknown[]) => {
  for (const value of values) {
    expect(schema.safeParse(value).success, String(value)).toBe(true)
  }
}

const expectRejected = (schema: { safeParse: (value: unknown) => { success: boolean } }, values: readonly unknown[]) => {
  for (const value of values) {
    expect(schema.safeParse(value).success, String(value)).toBe(false)
  }
}

describe("identifier and temporal scalars", () => {
  it("exports the scalar kernel from the package root", () => {
    expect(Contracts.Uuid).toBe(Uuid)
    expect(Contracts.PasswordInput).toBe(PasswordInput)
  })

  it("accepts canonical UUIDs and rejects malformed values", () => {
    expectAccepted(Uuid, ["123e4567-e89b-42d3-a456-426614174000"])
    expectRejected(Uuid, ["not-a-uuid", "123e4567e89b42d3a456426614174000", 42])
  })

  it("accepts ISO datetimes with Z or an explicit offset", () => {
    expectAccepted(IsoDateTime, ["2026-07-17T10:30:00Z", "2026-07-17T16:00:00+05:30"])
    expect(IsoDateTime.parse("2026-07-17T16:00:00+05:30")).toBe("2026-07-17T10:30:00.000Z")
    expectRejected(IsoDateTime, ["2026-07-17T10:30:00", "2026-02-30T10:30:00Z", "not-a-date"])
  })

  it("rejects offsets whose UTC output escapes the four-digit year range", () => {
    expectRejected(IsoDateTime, [
      "0000-01-01T00:00:00+23:59",
      "9999-12-31T23:59:59-23:59",
    ])
  })
})

describe("identity input scalars", () => {
  it("trims and validates email inputs after trimming", () => {
    const maximumEmail = `${"a".repeat(242)}@example.com`

    expect(EmailInput.parse("  Learner@example.com  ")).toBe("Learner@example.com")
    expectAccepted(EmailInput, [maximumEmail])
    expectRejected(EmailInput, [`a${maximumEmail}`, "missing-at.example.com", 42])
  })

  it("accepts only the canonical masked-email shape", () => {
    const maximumDomain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}`
    const oversizedDomain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}`

    expectAccepted(MaskedEmail, [
      "a***@example.com",
      "💡***@xn--bcher-kva.example",
      `a***@${maximumDomain}`,
      `a***@${"a".repeat(63)}.example`,
    ])
    expectRejected(MaskedEmail, [
      "ab***@example.com",
      "a**@example.com",
      "a***@Example.com",
      "a***@-bad.example",
      "a***@bad-.example",
      `a***@${oversizedDomain}`,
      `a***@${"a".repeat(64)}.example`,
      "a***@xn--a.example",
      "a***@xn--abc.example",
      "a***@xn--zzzz.example",
      "@***@example.com",
      ".***@example.com",
      "\"***@example.com",
      "\\***@example.com",
      "\ud800***@example.com",
    ])
  })

  it("trims phone input and enforces post-trim length", () => {
    expect(PhoneInput.parse("  +919876543210  ")).toBe("+919876543210")
    expectAccepted(PhoneInput, ["12345678", "1".repeat(32)])
    expectRejected(PhoneInput, ["1".repeat(7), "1".repeat(33), 42])
  })

  it("trims full names and counts Unicode code points", () => {
    expect(FullName.parse("  Ada Lovelace  ")).toBe("Ada Lovelace")
    expectAccepted(FullName, ["李雷", "💡💡", "a".repeat(120)])
    expectRejected(FullName, ["a", "a".repeat(121), "A\u0000B", "A\u0085B", "A\ud800B"])
  })

  it("preserves password bytes while enforcing code-point and control limits", () => {
    const spacedPassword = "  abcdefghij"

    expect(PasswordInput.parse(spacedPassword)).toBe(spacedPassword)
    expectAccepted(PasswordInput, ["💡".repeat(12), "a".repeat(128)])
    expectRejected(PasswordInput, [
      "a".repeat(11),
      "a".repeat(129),
      "abcdefghijk\u0000",
      "abcdefghijk\ud800",
      42,
    ])
  })
})

describe("bounded text scalars", () => {
  it("validates reason codes after trimming", () => {
    expect(ReasonCode.parse("  needs_review  ")).toBe("needs_review")
    expectAccepted(ReasonCode, ["abc", `a${"1".repeat(63)}`])
    expectRejected(ReasonCode, ["ab", `a${"1".repeat(64)}`, "Needs_review", "needs-review"])
  })

  it("validates reason detail by Unicode code points", () => {
    expect(ReasonDetail.parse("  clear explanation  ")).toBe("clear explanation")
    expectAccepted(ReasonDetail, ["💡", "a".repeat(2000)])
    expectRejected(ReasonDetail, ["   ", "a".repeat(2001), "\ud800", 42])
  })

  it("validates version tags after trimming", () => {
    expect(VersionTag.parse("  terms_v1.2-rc  ")).toBe("terms_v1.2-rc")
    expectAccepted(VersionTag, ["v", "a".repeat(40)])
    expectRejected(VersionTag, ["", "a".repeat(41), "version tag", "v/1"])
  })
})

describe("opaque key and numeric wire scalars", () => {
  it("validates idempotency keys without trimming", () => {
    expectAccepted(IdempotencyKey, ["request1", "a".repeat(128), "req:1_2-3.4"])
    expectRejected(IdempotencyKey, ["short", "a".repeat(129), " request1", "request/1"])
  })

  it("validates the signed two-part opaque cursor the backend mints", () => {
    const body = "a".repeat(16)
    const signature = "AbCd_ef-gh12_345"
    expectAccepted(Cursor, [
      `${body}.${signature}`,
      `${"a".repeat(1024)}.${"b".repeat(1024)}`,
      "eyJyIjoiL3YxL2NsaWVudC9vcmRlcnMifQ.gB5Sekmh_62z0tk1PTQtohyKh_O7q31wG6PDAczV0mI",
    ])
    expectRejected(Cursor, [
      body,
      `${"a".repeat(15)}.${signature}`,
      `${body}.${"b".repeat(15)}`,
      `${body}.${signature}.${signature}`,
      `${body}.${signature} `,
      `abc defghijklmno.${signature}`,
      `abcdefghijklmn+/.${signature}`,
    ])
  })

  it("accepts canonical non-negative paise strings only", () => {
    expectAccepted(Paise, ["0", "1", "9223372036854775807"])
    expectRejected(Paise, ["00", "01", "-1", "1.0", "1e3", "9223372036854775808", 100])
  })

  it.each([
    [
      Decimal24x8,
      ["0", "-1", "1.12345678", `${"9".repeat(16)}.12345678`],
      ["01", "1.", "1.123456789", "9".repeat(17), "+1", 1],
    ],
    [
      Decimal30x12,
      ["0", "-1", "1.123456789012", `${"9".repeat(18)}.123456789012`],
      ["01", "1.", "1.1234567890123", "9".repeat(19), "+1", 1],
    ],
  ] as const)("validates canonical decimal strings", (schema, accepted, rejected) => {
    expectAccepted(schema, accepted)
    expectRejected(schema, rejected)
  })

  it("emits fixed-scale canonical decimal strings", () => {
    expect(Decimal24x8.parse("-1.2")).toBe("-1.20000000")
    expect(Decimal30x12.parse("1")).toBe("1.000000000000")
  })

  it("canonicalizes negative decimal zero without preserving its sign", () => {
    expect(Decimal24x8.parse("-0")).toBe("0.00000000")
    expect(Decimal30x12.parse("-0.000")).toBe("0.000000000000")
  })

  it("keeps canonicalizing schemas representable as JSON Schema", () => {
    expect(() => z.toJSONSchema(IsoDateTime, { io: "output" })).not.toThrow()
    expect(() => z.toJSONSchema(Decimal24x8, { io: "output" })).not.toThrow()
    expect(() => z.toJSONSchema(Decimal30x12, { io: "output" })).not.toThrow()
  })
})
