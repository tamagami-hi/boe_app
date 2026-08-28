import { describe, expect, test } from "vitest"

import { addUtcMonthsClamped, buildMandateReturnUrl } from "./clientAutoPaySipRoutes.js"

describe("AutoPay mandate expiry", () => {
  test("clamps month-end in UTC without rolling into the following month", () => {
    expect(addUtcMonthsClamped(new Date("2026-01-31T23:15:00.000Z"), 1).toISOString())
      .toBe("2026-02-28T23:15:00.000Z")
    expect(addUtcMonthsClamped(new Date("2024-01-31T23:15:00.000Z"), 1).toISOString())
      .toBe("2024-02-29T23:15:00.000Z")
  })
})

describe("AutoPay hosted return URL", () => {
  test("returns to the client dashboard with stable payment and SIP identifiers", () => {
    expect(buildMandateReturnUrl("https://app.example/dashboard", {
      paymentId: "11111111-1111-4111-8111-111111111111",
      sipPlanId: "22222222-2222-4222-8222-222222222222",
    })).toBe(
      "https://app.example/dashboard?paymentId=11111111-1111-4111-8111-111111111111&sipPlanId=22222222-2222-4222-8222-222222222222",
    )
  })
})
