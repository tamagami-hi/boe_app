import { describe, expect, test } from "vitest"

import {
  resolveFailureDelayMs,
  resolvePendingDelayMs,
  resolveWakeDelayMs,
  type ReconciliationCadence,
} from "./reconciliationCadence.js"

const cadence: ReconciliationCadence = {
  fastIntervalMs: 1_000,
  pendingIntervalMs: 30_000,
  fastWindowMs: 180_000,
  maxBackoffMs: 900_000,
  expiryGraceMs: 300_000,
}

const now = new Date("2026-08-30T02:00:00.000Z")
const at = (offsetMs: number): Date => new Date(now.getTime() + offsetMs)

describe("pending cadence follows the checkout, not a fixed clock", () => {
  test("polls every second while the client is still on the provider page", () => {
    expect(resolvePendingDelayMs({
      now,
      dispatchStartedAt: at(-5_000),
      checkoutExpiresAt: at(780_000),
    }, cadence)).toBe(1_000)
  })

  test("drops to the periodic interval once the fast window has elapsed", () => {
    expect(resolvePendingDelayMs({
      now,
      dispatchStartedAt: at(-181_000),
      checkoutExpiresAt: at(600_000),
    }, cadence)).toBe(30_000)
  })

  test("does not poll fast for an attempt that was never dispatched", () => {
    expect(resolvePendingDelayMs({
      now,
      dispatchStartedAt: null,
      checkoutExpiresAt: at(780_000),
    }, cadence)).toBe(30_000)
  })

  test("stops polling fast once the checkout window plus grace has passed", () => {
    expect(resolvePendingDelayMs({
      now,
      dispatchStartedAt: at(-5_000),
      checkoutExpiresAt: at(-300_001),
    }, cadence)).toBe(30_000)
  })

  test("accepts timestamps that arrive from the driver as strings", () => {
    expect(resolvePendingDelayMs({
      now,
      dispatchStartedAt: at(-5_000).toISOString(),
      checkoutExpiresAt: at(780_000).toISOString(),
    }, cadence)).toBe(1_000)
  })
})

describe("gateway failures never park a live checkout behind a long backoff", () => {
  test("a live checkout is retried within the periodic interval despite a high failure count", () => {
    expect(resolveFailureDelayMs({
      now,
      dispatchStartedAt: at(-10_000),
      checkoutExpiresAt: at(600_000),
      failureCount: 8,
      throttled: false,
    }, cadence)).toBe(30_000)
  })

  test("an expired checkout still backs off exponentially", () => {
    expect(resolveFailureDelayMs({
      now,
      dispatchStartedAt: at(-900_000),
      checkoutExpiresAt: at(-400_000),
      failureCount: 3,
      throttled: false,
    }, cadence)).toBe(240_000)
  })

  test("explicit provider throttling is always obeyed, even for a live checkout", () => {
    expect(resolveFailureDelayMs({
      now,
      dispatchStartedAt: at(-10_000),
      checkoutExpiresAt: at(600_000),
      failureCount: 2,
      throttled: true,
    }, cadence)).toBe(240_000)
  })

  test("backoff is capped at the configured ceiling", () => {
    expect(resolveFailureDelayMs({
      now,
      dispatchStartedAt: at(-900_000),
      checkoutExpiresAt: at(-400_000),
      failureCount: 10,
      throttled: false,
    }, cadence)).toBe(900_000)
  })
})

describe("the loop sleeps until there is something to do", () => {
  test("sleeps for the idle interval when nothing is claimable", () => {
    expect(resolveWakeDelayMs({ now, earliestDueAt: null, idleIntervalMs: 5_000 })).toBe(5_000)
  })

  test("wakes at the earliest due attempt rather than a fixed interval", () => {
    expect(resolveWakeDelayMs({
      now,
      earliestDueAt: at(1_000),
      idleIntervalMs: 5_000,
    })).toBe(1_000)
  })

  test("runs immediately when work is already overdue", () => {
    expect(resolveWakeDelayMs({
      now,
      earliestDueAt: at(-60_000),
      idleIntervalMs: 5_000,
    })).toBe(50)
  })

  test("never sleeps past the idle interval, so new work is noticed", () => {
    expect(resolveWakeDelayMs({
      now,
      earliestDueAt: at(900_000),
      idleIntervalMs: 5_000,
    })).toBe(5_000)
  })
})
