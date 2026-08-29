import { describe, expect, it } from "vitest"

import { IDLE_LOCK_THRESHOLD_MS, shouldLock } from "~/features/device-security/lockDecision"

const NOW = 1_700_000_000_000

const base = {
  native: true,
  enrolled: true,
  trigger: "resume",
  leftAt: NOW - IDLE_LOCK_THRESHOLD_MS,
  now: NOW,
} as const

describe("device lock decision", () => {
  it("locks a cold start when a credential is enrolled", () => {
    expect(shouldLock({ ...base, trigger: "cold-start", leftAt: null })).toBe(true)
  })

  it("never locks when nothing is enrolled", () => {
    expect(shouldLock({ ...base, trigger: "cold-start", enrolled: false })).toBe(false)
    expect(shouldLock({ ...base, enrolled: false })).toBe(false)
  })

  it("never locks off-device, because there is no lock to enforce on the web", () => {
    expect(shouldLock({ ...base, native: false, trigger: "cold-start" })).toBe(false)
    expect(shouldLock({ ...base, native: false })).toBe(false)
  })

  it("locks on resume once the idle threshold is reached", () => {
    expect(shouldLock(base)).toBe(true)
    expect(shouldLock({ ...base, leftAt: NOW - IDLE_LOCK_THRESHOLD_MS - 1 })).toBe(true)
  })

  it("does not lock on resume below the idle threshold", () => {
    expect(shouldLock({ ...base, leftAt: NOW - IDLE_LOCK_THRESHOLD_MS + 1 })).toBe(false)
    expect(shouldLock({ ...base, leftAt: NOW })).toBe(false)
  })

  it("honours an explicit threshold", () => {
    expect(shouldLock({ ...base, leftAt: NOW - 5_000, idleThresholdMs: 1_000 })).toBe(true)
    expect(shouldLock({ ...base, leftAt: NOW - 5_000, idleThresholdMs: 10_000 })).toBe(false)
  })

  it("locks when the time away cannot be established", () => {
    expect(shouldLock({ ...base, leftAt: null })).toBe(true)
    expect(shouldLock({ ...base, leftAt: Number.NaN })).toBe(true)
    expect(shouldLock({ ...base, now: Number.NaN })).toBe(true)
  })

  it("locks when the clock moved backwards while the app was away", () => {
    expect(shouldLock({ ...base, leftAt: NOW + 60_000 })).toBe(true)
  })
})
