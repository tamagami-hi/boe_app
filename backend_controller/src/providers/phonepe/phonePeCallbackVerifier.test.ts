import { createHash } from "node:crypto"

import { describe, expect, test } from "vitest"

import { GatewayAuthenticationError, GatewayMalformedCallbackError } from "./paymentGateway.js"
import { createPhonePeCallbackVerifier } from "./phonePeCallbackVerifier.js"

const CONFIG = {
  callbackUsername: "callback-user",
  callbackPassword: "callback-password",
} as const

const verifier = createPhonePeCallbackVerifier(CONFIG)

const authorization = createHash("sha256")
  .update(`${CONFIG.callbackUsername}:${CONFIG.callbackPassword}`)
  .digest("hex")

const rawBody = JSON.stringify({
  event: "checkout.order.completed",
  payload: {
    merchantId: "merchant-1",
    orderId: "provider-order-1",
    merchantOrderId: "boe_1",
    state: "COMPLETED",
    amount: 500000,
    paymentDetails: [
      { transactionId: "txn-1", paymentMode: "UPI", timestamp: 1, amount: 500000, state: "COMPLETED" },
    ],
  },
})

describe("validateShaCallback", () => {
  test("maps an authorized callback from `event` and `payload.state`", () => {
    const fact = verifier.validateShaCallback(authorization, rawBody)
    expect(fact).toMatchObject({
      event: "checkout.order.completed",
      outcome: "succeeded",
      providerState: "COMPLETED",
      merchantOrderId: "boe_1",
      providerOrderId: "provider-order-1",
      amountPaise: "500000",
    })
    expect(fact.details).toHaveLength(1)
  })

  test("an authorization failure is its own error type (zero writes follow)", () => {
    expect(() => verifier.validateShaCallback("wrong", rawBody)).toThrow(GatewayAuthenticationError)
  })

  test("a correctly formed but wrong digest is rejected", () => {
    const wrong = createHash("sha256").update("callback-user:not-the-password").digest("hex")
    expect(() => verifier.validateShaCallback(wrong, rawBody)).toThrow(GatewayAuthenticationError)
  })

  test("malformed bodies are a separate error type", () => {
    expect(() => verifier.validateShaCallback(authorization, "not-json"))
      .toThrow(GatewayMalformedCallbackError)
    expect(() =>
      verifier.validateShaCallback(authorization, JSON.stringify({ payload: { state: "COMPLETED" } })),
    ).toThrow(GatewayMalformedCallbackError)
    expect(() =>
      verifier.validateShaCallback(
        authorization,
        JSON.stringify({ type: "PG_ORDER_COMPLETED", payload: { state: "COMPLETED", merchantOrderId: "boe_1" } }),
      ),
    ).toThrow(GatewayMalformedCallbackError)
  })

  test("maps refund callbacks with merchant refund correlation", () => {
    const fact = verifier.validateShaCallback(
      authorization,
      JSON.stringify({
        event: "pg.refund.completed",
        payload: {
          merchantRefundId: "boe_rf_1",
          refundId: "provider-refund-1",
          originalMerchantOrderId: "boe_1",
          state: "COMPLETED",
          amount: 500000,
        },
      }),
    )
    expect(fact).toMatchObject({
      event: "pg.refund.completed",
      outcome: "succeeded",
      merchantRefundId: "boe_rf_1",
      originalMerchantOrderId: "boe_1",
      providerRefundId: "provider-refund-1",
      amountPaise: "500000",
    })
  })

  test("maps FAILED to failed and leaves unknown states non-terminal", () => {
    const callbackWith = (state: string): string =>
      JSON.stringify({ event: "checkout.order.completed", payload: { state, merchantOrderId: "boe_1" } })

    expect(verifier.validateShaCallback(authorization, callbackWith("FAILED")).outcome).toBe("failed")
    expect(verifier.validateShaCallback(authorization, callbackWith("PENDING")).outcome).toBe("pending")
    expect(verifier.validateShaCallback(authorization, callbackWith("SOMETHING_NEW")).outcome).toBe("pending")
  })

  test("does not select an ambiguous split-instrument UTR", () => {
    const fact = verifier.validateShaCallback(
      authorization,
      JSON.stringify({
        event: "checkout.order.completed",
        payload: {
          state: "COMPLETED",
          merchantOrderId: "boe_1",
          paymentDetails: [
            {
              transactionId: "txn-1",
              referenceId: "ref-1",
              splitInstruments: [
                { rail: { utr: "utr-a" }, instrument: { type: "UPI" } },
                { rail: { utr: "utr-b" }, instrument: { type: "UPI" } },
              ],
            },
          ],
        },
      }),
    )
    expect(fact.details[0]?.reference).toBeNull()
    expect(fact.details[0]?.instrumentType).toBe("UPI")
  })

  test("skips a payment detail that cannot be keyed by a transaction id", () => {
    const fact = verifier.validateShaCallback(
      authorization,
      JSON.stringify({
        event: "checkout.order.completed",
        payload: {
          state: "COMPLETED",
          merchantOrderId: "boe_1",
          paymentDetails: [{ paymentMode: "UPI", amount: 100 }],
        },
      }),
    )
    expect(fact.details).toHaveLength(0)
  })

  test("rejects a non-integral amount as unusable evidence", () => {
    const fact = verifier.validateShaCallback(
      authorization,
      JSON.stringify({
        event: "checkout.order.completed",
        payload: { state: "COMPLETED", merchantOrderId: "boe_1", amount: 12.5 },
      }),
    )
    expect(fact.amountPaise).toBeNull()
  })
})
