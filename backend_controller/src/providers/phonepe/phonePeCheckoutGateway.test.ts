/**
 * PhonePe checkout gateway adapter tests (spec §7, §14 "Payment and PhonePe").
 *
 * The adapter is the only module allowed to see PhonePe SDK shapes; these tests
 * pin the mapping both ways with a stub SDK client: exact paise amounts and
 * stable merchant ids out, tolerant domain facts in, and the terminality
 * contract (COMPLETED -> succeeded, FAILED -> failed, everything else
 * non-terminal). Callback authorization failures and malformed bodies are
 * distinct error types because the ingress route must answer them differently
 * while writing nothing either way.
 */
import { describe, expect, test } from "vitest"

import {
  GatewayAuthenticationError,
  GatewayMalformedCallbackError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
} from "./paymentGateway.js"
import {
  createPhonePeCheckoutGateway,
  type PhonePeSdkClient,
} from "./phonePeCheckoutGateway.js"

const CONFIG = {
  clientId: "merchant-client-id",
  clientSecret: "merchant-client-secret",
  clientVersion: "1",
  env: "sandbox" as const,
  callbackUsername: "callback-user",
  callbackPassword: "callback-pass",
  redirectUrl: "https://app.beonedge.in/payment-status",
}

/** Test double for the SDK exception taxonomy (structural, no SDK import). */
const sdkError = (httpStatusCode: number): Error => {
  const error = new Error("phonepe error")
  error.name = "PhonePeException"
  Object.assign(error, { httpStatusCode, type: "TEST" })
  return error
}

const isPhonePeException = (error: unknown): boolean =>
  error instanceof Error && error.name === "PhonePeException"

const stubClient = (overrides: Partial<PhonePeSdkClient> = {}): PhonePeSdkClient => ({
  pay: async () => {
    throw new Error("pay not stubbed")
  },
  getOrderStatus: async () => {
    throw new Error("getOrderStatus not stubbed")
  },
  validateCallback: () => {
    throw new Error("validateCallback not stubbed")
  },
  refund: async () => {
    throw new Error("refund not stubbed")
  },
  getRefundStatus: async () => {
    throw new Error("getRefundStatus not stubbed")
  },
  ...overrides,
})

describe("createCheckout", () => {
  test("sends the stable merchant order id and the exact paise amount", async () => {
    let seen: unknown
    const gateway = createPhonePeCheckoutGateway({
      config: CONFIG,
      client: stubClient({
        pay: async (request) => {
          seen = request
          return {
            orderId: "provider-order-1",
            state: "PENDING",
            expireAt: 1_800_000_000_000,
            redirectUrl: "https://checkout.phonepe.example/pay/abc",
          }
        },
      }),
    })

    const result = await gateway.createCheckout({
      merchantOrderId: "boe_0123456789abcdef0123456789abcdef",
      amountPaise: "500000",
      redirectUrl: "https://app.beonedge.in/payment-status",
      expireAfterSeconds: 900,
    })

    expect(result).toEqual({
      redirectUrl: "https://checkout.phonepe.example/pay/abc",
      providerOrderId: "provider-order-1",
      expiresAt: new Date(1_800_000_000_000),
    })
    const request = seen as Record<string, unknown>
    expect(request.merchantOrderId).toBe("boe_0123456789abcdef0123456789abcdef")
    expect(request.amount).toBe(500000)
  })

  test("refuses amounts that a JS number cannot represent exactly", async () => {
    const gateway = createPhonePeCheckoutGateway({ config: CONFIG, client: stubClient() })
    await expect(
      gateway.createCheckout({
        merchantOrderId: "boe_x",
        amountPaise: "9007199254740993", // 2^53 + 1
        redirectUrl: null,
        expireAfterSeconds: 900,
      }),
    ).rejects.toBeInstanceOf(GatewayRejectedError)
    await expect(
      gateway.createCheckout({
        merchantOrderId: "boe_x",
        amountPaise: "100.5",
        redirectUrl: null,
        expireAfterSeconds: 900,
      }),
    ).rejects.toBeInstanceOf(GatewayRejectedError)
  })
})

describe("getOrderStatus", () => {
  const statusClient = (response: unknown): PhonePeSdkClient =>
    stubClient({ getOrderStatus: async () => response })

  test("maps COMPLETED to succeeded and retains every payment detail", async () => {
    const gateway = createPhonePeCheckoutGateway({
      config: CONFIG,
      client: statusClient({
        merchantOrderId: "boe_1",
        orderId: "provider-order-1",
        state: "COMPLETED",
        amount: 500000,
        expireAt: 1_800_000_000_000,
        paymentDetails: [
          { transactionId: "txn-1", paymentMode: "UPI", timestamp: 1, amount: 300000, state: "COMPLETED" },
          { transactionId: "txn-2", paymentMode: "CARD", timestamp: 2, amount: 200000, state: "COMPLETED" },
        ],
        // Tolerant deserialization: unknown future fields are ignored.
        brandNewField: { nested: true },
      }),
    })

    const fact = await gateway.getOrderStatus("boe_1")
    expect(fact.outcome).toBe("succeeded")
    expect(fact.providerState).toBe("COMPLETED")
    expect(fact.providerOrderId).toBe("provider-order-1")
    expect(fact.amountPaise).toBe("500000")
    // Multiple paymentDetails are retained — never collapsed into one field.
    expect(fact.details).toEqual([
      { transactionId: "txn-1", reference: null, instrumentType: "UPI", state: "COMPLETED", amountPaise: "300000" },
      { transactionId: "txn-2", reference: null, instrumentType: "CARD", state: "COMPLETED", amountPaise: "200000" },
    ])
  })

  test("maps FAILED to failed and PENDING to pending; unknown states stay non-terminal", async () => {
    const gateway = createPhonePeCheckoutGateway({ config: CONFIG, client: stubClient() })
    const withState = (state: string) =>
      createPhonePeCheckoutGateway({
        config: CONFIG,
        client: statusClient({ orderId: "o", state, amount: 100, expireAt: 1, paymentDetails: [] }),
      })

    await expect(withState("FAILED").getOrderStatus("boe_1").then((fact) => fact.outcome)).resolves.toBe("failed")
    await expect(withState("PENDING").getOrderStatus("boe_1").then((fact) => fact.outcome)).resolves.toBe("pending")
    // An unrecognised provider state must never be promoted to success.
    await expect(withState("SOMETHING_NEW").getOrderStatus("boe_1").then((fact) => fact.outcome)).resolves.toBe("pending")
    expect(gateway).toBeDefined()
  })
})

describe("validateShaCallback", () => {
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

  const authOkClient = (): PhonePeSdkClient => stubClient({ validateCallback: () => ({}) })

  test("maps an authorized callback from `event` and `payload.state`", () => {
    const gateway = createPhonePeCheckoutGateway({ config: CONFIG, client: authOkClient() })
    const fact = gateway.validateShaCallback("sha256-auth", rawBody)
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
    const gateway = createPhonePeCheckoutGateway({
      config: CONFIG,
      client: stubClient({
        validateCallback: () => {
          throw sdkError(417)
        },
      }),
    })
    expect(() => gateway.validateShaCallback("wrong", rawBody)).toThrow(GatewayAuthenticationError)
  })

  test("malformed bodies are a separate error type", () => {
    const gateway = createPhonePeCheckoutGateway({ config: CONFIG, client: authOkClient() })
    expect(() => gateway.validateShaCallback("auth", "not-json")).toThrow(GatewayMalformedCallbackError)
    expect(() => gateway.validateShaCallback("auth", JSON.stringify({ payload: { state: "COMPLETED" } }))).toThrow(
      GatewayMalformedCallbackError,
    )
    // The legacy `type` field is not a substitute for `event` (spec §7).
    expect(() =>
      gateway.validateShaCallback(
        "auth",
        JSON.stringify({ type: "PG_ORDER_COMPLETED", payload: { state: "COMPLETED", merchantOrderId: "boe_1" } }),
      ),
    ).toThrow(GatewayMalformedCallbackError)
    expect(isPhonePeException(sdkError(417))).toBe(true)
  })

  test("maps refund callbacks with merchant refund correlation", () => {
    const gateway = createPhonePeCheckoutGateway({ config: CONFIG, client: authOkClient() })
    const fact = gateway.validateShaCallback(
      "auth",
      JSON.stringify({
        event: "pg.refund.completed",
        payload: {
          merchantRefundId: "boe_rf_1",
          originalMerchantOrderId: "boe_1",
          refundId: "provider-refund-1",
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
})

describe("refunds", () => {
  test("initiateRefund sends the stable merchant refund id and exact amount", async () => {
    let seen: unknown
    const gateway = createPhonePeCheckoutGateway({
      config: CONFIG,
      client: stubClient({
        refund: async (request) => {
          seen = request
          return { refundId: "provider-refund-1", amount: 500000, state: "PENDING" }
        },
      }),
    })
    const result = await gateway.initiateRefund({
      merchantRefundId: "boe_rf_1",
      originalMerchantOrderId: "boe_1",
      amountPaise: "500000",
    })
    expect(result).toEqual({ providerRefundId: "provider-refund-1", outcome: "pending", providerState: "PENDING" })
    const request = seen as Record<string, unknown>
    expect(request.merchantRefundId).toBe("boe_rf_1")
    expect(request.originalMerchantOrderId).toBe("boe_1")
    expect(request.amount).toBe(500000)
  })

  test("getRefundStatus maps states", async () => {
    const gateway = createPhonePeCheckoutGateway({
      config: CONFIG,
      client: stubClient({
        getRefundStatus: async () => ({
          merchantId: "m",
          merchantRefundId: "boe_rf_1",
          originalMerchantOrderId: "boe_1",
          amount: 500000,
          state: "COMPLETED",
          paymentDetails: [],
        }),
      }),
    })
    const fact = await gateway.getRefundStatus("boe_rf_1")
    expect(fact.outcome).toBe("succeeded")
    expect(fact.merchantRefundId).toBe("boe_rf_1")
    expect(fact.amountPaise).toBe("500000")
  })
})

describe("error mapping", () => {
  test("network errors are unavailable, 404 is not-found, 400 is rejected", async () => {
    const withError = (error: unknown) =>
      createPhonePeCheckoutGateway({
        config: CONFIG,
        client: stubClient({
          getOrderStatus: async () => {
            throw error
          },
        }),
      })

    await expect(withError(new Error("socket hangup")).getOrderStatus("boe_1")).rejects.toBeInstanceOf(
      GatewayUnavailableError,
    )
    await expect(withError(sdkError(404)).getOrderStatus("boe_1")).rejects.toBeInstanceOf(GatewayNotFoundError)
    await expect(withError(sdkError(400)).getOrderStatus("boe_1")).rejects.toBeInstanceOf(GatewayRejectedError)
    await expect(withError(sdkError(503)).getOrderStatus("boe_1")).rejects.toBeInstanceOf(GatewayUnavailableError)
  })
})
