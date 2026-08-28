import { describe, expect, it } from "vitest"

import {
  CheckoutUrlRejected,
  assertAllowedCheckoutUrl,
  decideCheckout,
} from "~/features/payments/checkout"

const ALLOWLIST = ["https://mercury-t2.phonepe.com"] as const

describe("assertAllowedCheckoutUrl", () => {
  it("accepts an exact allowlisted https origin", () => {
    const url = assertAllowedCheckoutUrl(
      "https://mercury-t2.phonepe.com/transact/pg?token=abc",
      ALLOWLIST,
    )
    expect(url.origin).toBe("https://mercury-t2.phonepe.com")
  })

  it("refuses a non-https scheme", () => {
    expect(() =>
      assertAllowedCheckoutUrl("http://mercury-t2.phonepe.com/transact", ALLOWLIST),
    ).toThrow(CheckoutUrlRejected)
  })

  it("refuses an origin outside the allowlist", () => {
    expect(() => assertAllowedCheckoutUrl("https://phonepe.com.evil.test/pay", ALLOWLIST)).toThrow(
      CheckoutUrlRejected,
    )
  })

  it("refuses an allowlisted host reached through userinfo", () => {
    expect(() =>
      assertAllowedCheckoutUrl(
        "https://mercury-t2.phonepe.com@evil.test/pay",
        ALLOWLIST,
      ),
    ).toThrow(CheckoutUrlRejected)
  })

  it("refuses a subdomain of an allowlisted origin", () => {
    expect(() =>
      assertAllowedCheckoutUrl("https://a.mercury-t2.phonepe.com/pay", ALLOWLIST),
    ).toThrow(CheckoutUrlRejected)
  })

  it("refuses a value that is not a URL", () => {
    expect(() => assertAllowedCheckoutUrl("/transact/pg", ALLOWLIST)).toThrow(CheckoutUrlRejected)
  })
})

describe("decideCheckout", () => {
  it("treats a terminal order as a normal outcome, not an error", () => {
    expect(
      decideCheckout({ orderId: "order-1", status: "confirmed", terminal: true }, ALLOWLIST),
    ).toEqual({ kind: "terminal", orderId: "order-1", status: "confirmed" })
  })

  it("polls when the checkout is null instead of retrying the write", () => {
    expect(
      decideCheckout(
        {
          orderId: "order-1",
          status: "payment_in_progress",
          paymentId: "payment-1",
          checkout: null,
        },
        ALLOWLIST,
      ),
    ).toEqual({ kind: "poll", paymentId: "payment-1" })
  })

  it("polls when the checkout key is absent altogether", () => {
    expect(
      decideCheckout(
        { orderId: "order-1", status: "payment_in_progress", paymentId: "payment-1" },
        ALLOWLIST,
      ),
    ).toEqual({ kind: "poll", paymentId: "payment-1" })
  })

  it("redirects only to an allowlisted checkout address", () => {
    expect(
      decideCheckout(
        {
          orderId: "order-1",
          status: "payment_in_progress",
          paymentId: "payment-1",
          checkout: { type: "redirect", url: "https://mercury-t2.phonepe.com/transact/pg" },
        },
        ALLOWLIST,
      ),
    ).toEqual({
      kind: "redirect",
      paymentId: "payment-1",
      url: "https://mercury-t2.phonepe.com/transact/pg",
    })
  })

  it("refuses a checkout address the backend allowed but the client does not", () => {
    expect(() =>
      decideCheckout(
        {
          orderId: "order-1",
          status: "payment_in_progress",
          paymentId: "payment-1",
          checkout: { type: "redirect", url: "https://evil.test/pay" },
        },
        ALLOWLIST,
      ),
    ).toThrow(CheckoutUrlRejected)
  })

  it("refuses a non-terminal response with no payment identifier", () => {
    expect(() =>
      decideCheckout({ orderId: "order-1", status: "payment_in_progress" }, ALLOWLIST),
    ).toThrow(CheckoutUrlRejected)
  })
})
