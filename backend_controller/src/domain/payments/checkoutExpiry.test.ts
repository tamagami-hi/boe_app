import { describe, expect, test } from "vitest"

import {
  CHECKOUT_DISPATCH_BUFFER_MS,
  checkoutSecondsRemaining,
  MAX_PAYMENT_ATTEMPT_TTL_MS,
  MIN_PAYMENT_ATTEMPT_TTL_MS,
  PHONEPE_MAX_CHECKOUT_SECONDS,
  PHONEPE_MIN_CHECKOUT_SECONDS,
} from "./checkoutExpiry.js"

const now = new Date("2026-08-24T12:00:00.000Z")

describe("PhonePe checkout expiry", () => {
  test("preserves the provider minimum throughout the dispatch buffer", () => {
    const expiresAt = new Date(now.getTime() + MIN_PAYMENT_ATTEMPT_TTL_MS)
    const dispatchAt = new Date(now.getTime() + CHECKOUT_DISPATCH_BUFFER_MS)

    expect(checkoutSecondsRemaining(expiresAt, dispatchAt)).toBe(PHONEPE_MIN_CHECKOUT_SECONDS)
    expect(checkoutSecondsRemaining(expiresAt, new Date(dispatchAt.getTime() + 1))).toBeNull()
  })

  test("accepts the exact provider maximum", () => {
    const expiresAt = new Date(now.getTime() + MAX_PAYMENT_ATTEMPT_TTL_MS)

    expect(checkoutSecondsRemaining(expiresAt, now)).toBe(PHONEPE_MAX_CHECKOUT_SECONDS)
  })
})
