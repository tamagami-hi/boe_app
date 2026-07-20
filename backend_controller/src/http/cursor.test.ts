import { randomBytes } from "node:crypto"

import { describe, expect, test } from "vitest"

import { AppError } from "./errorCatalog.js"
import { computeFilterHash, decodeCursor, encodeCursor } from "./cursor.js"

const KEY = randomBytes(32)
const ROUTE = "/v1/admin/applications"
const NOW = new Date("2026-08-01T00:00:00.000Z")

const roundTrip = (route: string, filterHash: string, sortValues: readonly string[]): string =>
  encodeCursor(KEY, { route, filterHash, sortValues, now: NOW })

describe("cursor round-trip", () => {
  test("decodes the sort values it encoded", () => {
    const token = roundTrip(ROUTE, "fh", ["2026-07-20T10:00:00.000Z", "id-1"])
    expect(decodeCursor(KEY, token, { route: ROUTE, filterHash: "fh", now: NOW })).toEqual([
      "2026-07-20T10:00:00.000Z",
      "id-1",
    ])
  })
})

describe("cursor authentication", () => {
  test("rejects a tampered body", () => {
    const token = roundTrip(ROUTE, "fh", ["a", "b"])
    const [, signature] = token.split(".")
    const forged = `${Buffer.from("{\"r\":\"x\"}", "utf8").toString("base64url")}.${signature ?? ""}`
    expect(() => decodeCursor(KEY, forged, { route: ROUTE, filterHash: "fh", now: NOW })).toThrow(AppError)
  })

  test("rejects a signature made under a different key", () => {
    const token = roundTrip(ROUTE, "fh", ["a", "b"])
    expect(() => decodeCursor(randomBytes(32), token, { route: ROUTE, filterHash: "fh", now: NOW })).toThrow(
      AppError,
    )
  })

  test("rejects a malformed token", () => {
    expect(() => decodeCursor(KEY, "no-separator", { route: ROUTE, filterHash: "fh", now: NOW })).toThrow(AppError)
    expect(() => decodeCursor(KEY, ".onlysig", { route: ROUTE, filterHash: "fh", now: NOW })).toThrow(AppError)
  })
})

describe("cursor binding and expiry", () => {
  test("rejects a cursor replayed against a different route", () => {
    const token = roundTrip(ROUTE, "fh", ["a", "b"])
    expect(() =>
      decodeCursor(KEY, token, { route: "/v1/admin/email-deliveries", filterHash: "fh", now: NOW }),
    ).toThrow(AppError)
  })

  test("rejects a cursor reused with changed filters", () => {
    const token = roundTrip(ROUTE, "fh-a", ["a", "b"])
    expect(() => decodeCursor(KEY, token, { route: ROUTE, filterHash: "fh-b", now: NOW })).toThrow(AppError)
  })

  test("rejects an expired cursor", () => {
    const token = roundTrip(ROUTE, "fh", ["a", "b"])
    const later = new Date(NOW.getTime() + 25 * 60 * 60 * 1000)
    expect(() => decodeCursor(KEY, token, { route: ROUTE, filterHash: "fh", now: later })).toThrow(AppError)
  })
})

describe("computeFilterHash", () => {
  test("is stable regardless of key order and treats undefined as null", () => {
    expect(computeFilterHash({ a: "1", b: undefined })).toBe(computeFilterHash({ b: null, a: "1" }))
  })

  test("differs when a filter value changes", () => {
    expect(computeFilterHash({ status: "submitted" })).not.toBe(computeFilterHash({ status: "approved" }))
  })
})
