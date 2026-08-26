/**
 * PhonePe payment evidence and refund adapter tests.
 *
 * The adapter is the only module allowed to see PhonePe SDK shapes; these tests
 * pin the mapping both ways with a stub SDK client: exact paise amounts and
 * stable merchant ids out, tolerant domain facts in, and the terminality
 * contract (COMPLETED -> succeeded, FAILED -> failed, everything else
 * non-terminal). Callback authorization failures and malformed bodies are
 * distinct error types because the ingress route must answer them differently
 * while writing nothing either way.
 */
import { createHash } from "node:crypto"

import { describe, expect, test } from "vitest"

import {
  GatewayAuthenticationError,
  GatewayCredentialError,
  GatewayMalformedCallbackError,
  GatewayMalformedResponseError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
} from "./paymentGateway.js"
import {
  createPhonePeGateway,
  type PhonePeSdkClient,
} from "./phonePeCheckoutGateway.js"
import { classifyGatewayFailure, logGatewayFailure } from "./gatewayFailure.js"

const CONFIG = {
  clientId: "merchant-client-id",
  clientSecret: "merchant-client-secret",
  clientVersion: "1",
  env: "sandbox" as const,
  callbackUsername: "callback-user",
  callbackPassword: "callback-pass",
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
  getOrderStatus: () => Promise.reject(new Error("getOrderStatus not stubbed")),
  validateCallback: () => {
    throw new Error("validateCallback not stubbed")
  },
  refund: () => Promise.reject(new Error("refund not stubbed")),
  getRefundStatus: () => Promise.reject(new Error("getRefundStatus not stubbed")),
  ...overrides,
})

describe("getOrderStatus", () => {
  const statusClient = (response: unknown): PhonePeSdkClient =>
    stubClient({ getOrderStatus: () => Promise.resolve(response) })

  test("maps COMPLETED to succeeded and retains every payment detail", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: statusClient({
        merchantOrderId: "boe_1",
        orderId: "provider-order-1",
        state: "COMPLETED",
        amount: 500000,
        currency: "INR",
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
    expect(fact.merchantOrderId).toBe("boe_1")
    expect(fact.currency).toBe("INR")
    // Multiple paymentDetails are retained — never collapsed into one field.
    expect(fact.details).toEqual([
      { transactionId: "txn-1", reference: null, instrumentType: "UPI", state: "COMPLETED", amountPaise: "300000" },
      { transactionId: "txn-2", reference: null, instrumentType: "CARD", state: "COMPLETED", amountPaise: "200000" },
    ])
  })

  test("correlates an omitted V2 merchant order identifier from the requested path", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: statusClient({
        orderId: "provider-order-1",
        state: "PENDING",
        amount: 500000,
        currency: "INR",
        paymentDetails: [],
      }),
    })

    const fact = await gateway.getOrderStatus("boe_requested_order")

    expect(fact.merchantOrderId).toBe("boe_requested_order")
  })

  test("correlates an undefined V2 merchant order identifier from the requested path", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: statusClient({
        merchantOrderId: undefined,
        orderId: "provider-order-1",
        state: "PENDING",
        amount: 500000,
        currency: "INR",
        paymentDetails: [],
      }),
    })

    const fact = await gateway.getOrderStatus("boe_requested_order")

    expect(fact.merchantOrderId).toBe("boe_requested_order")
  })

  test.each(["", 42, false])("rejects an invalid echoed V2 merchant order identifier: %j", async (merchantOrderId) => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: statusClient({
        merchantOrderId,
        orderId: "provider-order-1",
        state: "PENDING",
        amount: 500000,
        currency: "INR",
        paymentDetails: [],
      }),
    })

    await expect(gateway.getOrderStatus("boe_requested_order")).rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })

  test("rejects a mismatched echoed V2 merchant order identifier", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: statusClient({
        merchantOrderId: "boe_different_order",
        orderId: "provider-order-1",
        state: "PENDING",
        amount: 500000,
        currency: "INR",
        paymentDetails: [],
      }),
    })

    await expect(gateway.getOrderStatus("boe_requested_order")).rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })

  test("maps V2 split instrument evidence without losing root transaction fields", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: statusClient({
        orderId: "provider-order-1",
        state: "COMPLETED",
        amount: 500000,
        currency: "INR",
        paymentDetails: [
          {
            transactionId: "txn-v2-1",
            paymentMode: "UPI",
            amount: 500000,
            state: "COMPLETED",
            splitInstruments: [
              {
                amount: 500000,
                rail: { type: "UPI", utr: "UTR123456789" },
                instrument: { type: "ACCOUNT", maskedAccountNumber: "XXXXXX1234" },
              },
            ],
          },
        ],
      }),
    })

    const fact = await gateway.getOrderStatus("boe_v2_order")

    expect(fact.details).toEqual([
      {
        transactionId: "txn-v2-1",
        reference: "UTR123456789",
        instrumentType: "ACCOUNT",
        state: "COMPLETED",
        amountPaise: "500000",
      },
    ])
  })

  test("does not select an ambiguous split-instrument UTR", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: statusClient({
        orderId: "provider-order-1",
        state: "COMPLETED",
        amount: 500000,
        currency: "INR",
        paymentDetails: [
          {
            transactionId: "txn-v2-1",
            amount: 500000,
            state: "COMPLETED",
            splitInstruments: [
              { rail: { utr: "UTR-ONE" }, instrument: { type: "ACCOUNT" } },
              { rail: { utr: "UTR-TWO" }, instrument: { type: "ACCOUNT" } },
            ],
          },
        ],
      }),
    })

    const fact = await gateway.getOrderStatus("boe_v2_order")

    expect(fact.details[0]?.reference).toBeNull()
  })

  test.each([
    "txn-with-control\ncharacter",
    "x".repeat(257),
  ])("discards an unsafe provider transaction identifier", async (transactionId) => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: statusClient({
        orderId: "provider-order-1",
        state: "COMPLETED",
        amount: 500000,
        currency: "INR",
        paymentDetails: [{ transactionId, state: "COMPLETED", amount: 500000 }],
      }),
    })

    const fact = await gateway.getOrderStatus("boe_v2_order")

    expect(fact.details).toEqual([])
  })

  test("discards a payment detail with oversized split evidence", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: statusClient({
        orderId: "provider-order-1",
        state: "COMPLETED",
        amount: 500000,
        currency: "INR",
        paymentDetails: [{
          transactionId: "txn-v2-1",
          state: "COMPLETED",
          amount: 500000,
          splitInstruments: Array.from({ length: 17 }, () => ({ rail: { utr: "UTR" } })),
        }],
      }),
    })

    const fact = await gateway.getOrderStatus("boe_v2_order")

    expect(fact.details).toEqual([])
  })

  test("maps FAILED to failed and PENDING to pending; unknown states stay non-terminal", async () => {
    const gateway = createPhonePeGateway({ config: CONFIG, client: stubClient() })
    const withState = (state: string) =>
      createPhonePeGateway({
        config: CONFIG,
        client: statusClient({ merchantOrderId: "boe_1", orderId: "o", state, amount: 100, currency: "INR", expireAt: 1, paymentDetails: [] }),
      })

    await expect(withState("FAILED").getOrderStatus("boe_1").then((fact) => fact.outcome)).resolves.toBe("failed")
    await expect(withState("PENDING").getOrderStatus("boe_1").then((fact) => fact.outcome)).resolves.toBe("pending")
    // An unrecognised provider state must never be promoted to success.
    await expect(withState("SOMETHING_NEW").getOrderStatus("boe_1").then((fact) => fact.outcome)).resolves.toBe("pending")
    expect(gateway).toBeDefined()
  })
})

describe("validateShaCallback", () => {
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

  const authOkClient = (): PhonePeSdkClient => stubClient({ validateCallback: () => ({}) })

  test("maps an authorized callback from `event` and `payload.state`", () => {
    const gateway = createPhonePeGateway({ config: CONFIG, client: authOkClient() })
    const fact = gateway.validateShaCallback(authorization, rawBody)
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
    const gateway = createPhonePeGateway({
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
    const gateway = createPhonePeGateway({ config: CONFIG, client: authOkClient() })
    expect(() => gateway.validateShaCallback(authorization, "not-json")).toThrow(GatewayMalformedCallbackError)
    expect(() => gateway.validateShaCallback(authorization, JSON.stringify({ payload: { state: "COMPLETED" } }))).toThrow(
      GatewayMalformedCallbackError,
    )
    // The legacy `type` field is not a substitute for `event` (spec §7).
    expect(() =>
      gateway.validateShaCallback(
        authorization,
        JSON.stringify({ type: "PG_ORDER_COMPLETED", payload: { state: "COMPLETED", merchantOrderId: "boe_1" } }),
      ),
    ).toThrow(GatewayMalformedCallbackError)
    expect(isPhonePeException(sdkError(417))).toBe(true)
  })

  test("maps refund callbacks with merchant refund correlation", () => {
    const gateway = createPhonePeGateway({ config: CONFIG, client: authOkClient() })
    const fact = gateway.validateShaCallback(
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
})

describe("refunds", () => {
  test("initiateRefund sends the stable merchant refund id and exact amount", async () => {
    let seen: unknown
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: stubClient({
        refund: (request) => {
          seen = request
          return Promise.resolve({ refundId: "provider-refund-1", amount: 500000, state: "PENDING" })
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
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: stubClient({
        getRefundStatus: () => Promise.resolve({
          merchantId: "m",
          merchantRefundId: "boe_rf_1",
          refundId: "provider-refund-1",
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
    expect(fact.providerRefundId).toBe("provider-refund-1")
    expect(fact.amountPaise).toBe("500000")
  })

  test("getRefundStatus rejects completed evidence without a provider refund identifier", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: stubClient({
        getRefundStatus: () => Promise.resolve({
          merchantRefundId: "boe_rf_1",
          originalMerchantOrderId: "boe_1",
          amount: 500000,
          state: "COMPLETED",
        }),
      }),
    })

    await expect(gateway.getRefundStatus("boe_rf_1")).rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })

  test("getRefundStatus rejects failed evidence without a provider refund identifier", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: stubClient({
        getRefundStatus: () => Promise.resolve({
          merchantRefundId: "boe_rf_1",
          originalMerchantOrderId: "boe_1",
          amount: 500000,
          state: "FAILED",
        }),
      }),
    })

    await expect(gateway.getRefundStatus("boe_rf_1")).rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })

  test("getRefundStatus rejects a mismatched merchant refund identifier", async () => {
    const gateway = createPhonePeGateway({
      config: CONFIG,
      client: stubClient({
        getRefundStatus: () => Promise.resolve({
          merchantRefundId: "boe_rf_other",
          originalMerchantOrderId: "boe_1",
          amount: 500000,
          state: "COMPLETED",
        }),
      }),
    })

    await expect(gateway.getRefundStatus("boe_rf_1")).rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })
})

describe("error mapping", () => {
  test("network errors are unavailable, provider auth is distinct, 404 is not-found, and 400 is rejected", async () => {
    const withError = (error: unknown) =>
      createPhonePeGateway({
        config: CONFIG,
        client: stubClient({
          getOrderStatus: () => Promise.reject(error instanceof Error ? error : new Error(String(error))),
        }),
      })

    await expect(withError(new Error("socket hangup")).getOrderStatus("boe_1")).rejects.toBeInstanceOf(
      GatewayUnavailableError,
    )
    await expect(withError(sdkError(401)).getOrderStatus("boe_1")).rejects.toBeInstanceOf(GatewayCredentialError)
    await expect(withError(sdkError(404)).getOrderStatus("boe_1")).rejects.toBeInstanceOf(GatewayNotFoundError)
    await expect(withError(sdkError(400)).getOrderStatus("boe_1")).rejects.toBeInstanceOf(GatewayRejectedError)
    await expect(withError(sdkError(503)).getOrderStatus("boe_1")).rejects.toBeInstanceOf(GatewayUnavailableError)
  })

  test("missing required provider response fields are malformed responses", async () => {
    const statusGateway = createPhonePeGateway({
      config: CONFIG,
      client: stubClient({ getOrderStatus: () => Promise.resolve({ orderId: "provider-order-1" }) }),
    })

    await expect(statusGateway.getOrderStatus("boe_1")).rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })

  test("classifies operational failures without serializing provider errors", () => {
    const warning: Record<string, unknown>[] = []
    const timeout = new GatewayUnavailableError("secret-bearing provider text", {
      cause: Object.assign(new Error("oauth-token-value"), { code: "ETIMEDOUT" }),
    })
    const provider5xx = new GatewayUnavailableError("provider failed", { cause: { httpStatusCode: 503 } })

    expect(classifyGatewayFailure(new GatewayCredentialError("bad credentials"))).toBe("provider_auth_rejected")
    expect(classifyGatewayFailure(new GatewayRejectedError("bad request"))).toBe("request_rejected")
    expect(classifyGatewayFailure(new GatewayMalformedResponseError("bad response"))).toBe("malformed_response")
    expect(classifyGatewayFailure(timeout)).toBe("provider_timeout")
    expect(classifyGatewayFailure(provider5xx)).toBe("provider_5xx")
    logGatewayFailure({ warn: (fields) => warning.push(fields) }, timeout, {
      requestId: "request-1",
      operation: "create_checkout",
    })
    expect(warning).toEqual([{
      requestId: "request-1",
      provider: "phonepe",
      operation: "create_checkout",
      failureKind: "provider_timeout",
    }])
    expect(JSON.stringify(warning)).not.toMatch(/secret-bearing|oauth-token-value/u)
  })
})
