import { describe, expect, test } from "vitest"

import { addUtcMonthsClamped } from "./clientAutoPaySipRoutes.js"

describe("AutoPay mandate expiry", () => {
  test("clamps month-end in UTC without rolling into the following month", () => {
    expect(addUtcMonthsClamped(new Date("2026-01-31T23:15:00.000Z"), 1).toISOString())
      .toBe("2026-02-28T23:15:00.000Z")
    expect(addUtcMonthsClamped(new Date("2024-01-31T23:15:00.000Z"), 1).toISOString())
      .toBe("2024-02-29T23:15:00.000Z")
  })
})
