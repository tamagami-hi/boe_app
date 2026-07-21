import { describe, expect, test } from "vitest"

import { errorEnvelope, successEnvelope } from "./envelope.js"

describe("envelope builders", () => {
  test("builds a success envelope with meta", () => {
    const envelope = successEnvelope(
      { id: "x" },
      { requestId: "req-1", timestamp: "2026-01-01T00:00:00.000Z" },
    )
    expect(envelope).toEqual({
      ok: true,
      data: { id: "x" },
      error: null,
      meta: { requestId: "req-1", timestamp: "2026-01-01T00:00:00.000Z" },
    })
  })

  test("includes idempotencyReplay only when provided", () => {
    const without = successEnvelope(null, { requestId: "r" })
    expect(without.meta.idempotencyReplay).toBeUndefined()
    const withReplay = successEnvelope(null, { requestId: "r", idempotencyReplay: true })
    expect(withReplay.meta.idempotencyReplay).toBe(true)
  })

  test("defaults the timestamp to a valid ISO string", () => {
    const envelope = successEnvelope(1, { requestId: "r" })
    expect(new Date(envelope.meta.timestamp).toISOString()).toBe(envelope.meta.timestamp)
  })

  test("builds an error envelope", () => {
    const envelope = errorEnvelope(
      { code: "VALIDATION_FAILED", message: "bad", retryable: false, fields: { a: ["x"] } },
      { requestId: "r", timestamp: "2026-01-01T00:00:00.000Z" },
    )
    expect(envelope.ok).toBe(false)
    expect(envelope.data).toBeNull()
    expect(envelope.error.code).toBe("VALIDATION_FAILED")
    expect(envelope.error.fields).toEqual({ a: ["x"] })
  })
})
