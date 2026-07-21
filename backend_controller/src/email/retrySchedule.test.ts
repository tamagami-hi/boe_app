import { describe, expect, test } from "vitest"

import {
  classifyFailure,
  isExhausted,
  jitterFraction,
  MAX_ATTEMPTS,
  MAX_JITTER_FRACTION,
  nextRetryDelayMs,
  RETRY_DELAYS_MS,
} from "./retrySchedule.js"

describe("retry schedule ladder", () => {
  test("has the seven documented intervals in order", () => {
    expect(RETRY_DELAYS_MS).toEqual([
      60_000, 300_000, 900_000, 3_600_000, 14_400_000, 43_200_000, 86_400_000,
    ])
    expect(MAX_ATTEMPTS).toBe(8)
  })

  test("each delay stays within [base, base * 1.2) of its ladder step", () => {
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      const base = RETRY_DELAYS_MS[attempt - 1] ?? 0
      const delay = nextRetryDelayMs(attempt, "event-abc")
      expect(delay).not.toBeNull()
      expect(delay).toBeGreaterThanOrEqual(base)
      expect(delay).toBeLessThan(Math.round(base * (1 + MAX_JITTER_FRACTION)) + 1)
    }
  })

  test("is deterministic for the same event and attempt", () => {
    expect(nextRetryDelayMs(3, "event-xyz")).toBe(nextRetryDelayMs(3, "event-xyz"))
  })

  test("differs across events (jitter is seeded by event id)", () => {
    const a = nextRetryDelayMs(4, "event-one")
    const b = nextRetryDelayMs(4, "event-two")
    expect(a).not.toBe(b)
  })

  test("returns null once attempts reach the cap", () => {
    expect(nextRetryDelayMs(MAX_ATTEMPTS, "event-abc")).toBeNull()
    expect(nextRetryDelayMs(MAX_ATTEMPTS + 3, "event-abc")).toBeNull()
  })

  test("rejects a non-positive or non-integer attempt count", () => {
    expect(() => nextRetryDelayMs(0, "e")).toThrow()
    expect(() => nextRetryDelayMs(-1, "e")).toThrow()
    expect(() => nextRetryDelayMs(1.5, "e")).toThrow()
  })
})

describe("jitterFraction", () => {
  test("stays within [0, MAX_JITTER_FRACTION)", () => {
    for (const seed of ["a", "b", "c", "long-seed-value", "1:2"]) {
      const fraction = jitterFraction(seed)
      expect(fraction).toBeGreaterThanOrEqual(0)
      expect(fraction).toBeLessThan(MAX_JITTER_FRACTION)
    }
  })
})

describe("isExhausted", () => {
  test("is true only at or beyond the cap", () => {
    expect(isExhausted(7)).toBe(false)
    expect(isExhausted(8)).toBe(true)
    expect(isExhausted(9)).toBe(true)
  })
})

describe("classifyFailure", () => {
  test.each([
    ["throttling", "retryable"],
    ["timeout", "retryable"],
    ["connection", "retryable"],
    ["server_5xx", "retryable"],
    ["client_4xx", "permanent"],
    ["rendering", "permanent"],
  ] as const)("classifies %s as %s", (kind, expected) => {
    expect(classifyFailure(kind)).toBe(expected)
  })
})
