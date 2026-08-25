import { describe, expect, test } from "vitest"

import { parsePaymentStates, paymentSuccessProjectionFor } from "./clientAccountRoutes.js"

describe("parsePaymentStates", () => {
  test("accepts repeatable query params as an array, not only a comma string", () => {
    expect(parsePaymentStates(["payment_in_progress"])).toEqual(["created", "provider_pending"])
    expect(parsePaymentStates(["payment_failed", "processing"])).toEqual(["failed", "expired", "succeeded"])
  })

  test("resolves every client-safe status name from clientStatus.ts", () => {
    expect(parsePaymentStates("payment_in_progress")).toEqual(["created", "provider_pending"])
    expect(parsePaymentStates("processing")).toEqual(["succeeded"])
    expect(parsePaymentStates("payment_failed")).toEqual(["failed", "expired"])
    expect(parsePaymentStates("refund_in_progress")).toEqual(["refund_pending"])
    expect(parsePaymentStates("support_required")).toEqual(["reconciliation_required", "refund_failed"])
    expect(parsePaymentStates("refunded")).toEqual(["refunded"])
  })

  test("still accepts a comma-separated string", () => {
    expect(parsePaymentStates("payment_in_progress,processing")).toEqual([
      "created",
      "provider_pending",
      "succeeded",
    ])
  })

  test("rejects an unknown token", () => {
    expect(() => parsePaymentStates("not_a_real_status")).toThrow()
  })

  test("returns an empty list when absent", () => {
    expect(parsePaymentStates(undefined)).toEqual([])
  })
})

describe("paymentSuccessProjectionFor", () => {
  test("distinguishes confirmed and processing succeeded-payment queries", () => {
    expect(paymentSuccessProjectionFor("confirmed")).toBe("confirmed")
    expect(paymentSuccessProjectionFor("processing")).toBe("processing")
  })

  test("does not constrain raw or combined succeeded-payment queries", () => {
    expect(paymentSuccessProjectionFor("succeeded")).toBeNull()
    expect(paymentSuccessProjectionFor("confirmed,processing")).toBeNull()
  })
})
