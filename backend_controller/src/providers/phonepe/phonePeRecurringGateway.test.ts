import { describe, expect, test } from "vitest"

import { GatewayUnavailableError } from "./paymentGateway.js"
import { createPhonePeRecurringGateway } from "./phonePeRecurringGateway.js"
import type { PhonePeHttpClient } from "./phonePeApiClient.js"

const response = (status: number, body?: unknown): Response =>
  body === undefined
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  clientVersion: "1",
  env: "sandbox" as const,
  requestTimeoutMs: 5_000,
}

describe("PhonePe recurring gateway", () => {
  test("creates the exact fixed monthly transaction mandate SDK order", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const httpClient: PhonePeHttpClient = (url, init) => {
      calls.push({ url, init })
      if (url.endsWith("/v1/oauth/token")) {
        return Promise.resolve(response(200, { access_token: "oauth-secret", token_type: "O-Bearer", expires_at: 1893456000 }))
      }
      return Promise.resolve(response(200, { orderId: "provider-order", state: "PENDING", expireAt: 1893456000000, token: "sdk-secret" }))
    }
    const gateway = createPhonePeRecurringGateway({ config, httpClient })
    const result = await gateway.createMandateSdkOrder({
      merchantOrderId: "boe_setup_1",
      merchantSubscriptionId: "boe_sip_1",
      amountPaise: "10000",
      expireAfterSeconds: 1200,
      mandateExpiresAt: new Date(1893456000000),
    })
    expect(result).toEqual({
      providerOrderId: "provider-order",
      providerState: "PENDING",
      sdkToken: "sdk-secret",
      expiresAt: new Date(1893456000000),
    })
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      merchantOrderId: "boe_setup_1",
      amount: 10000,
      expireAfter: 1200,
      paymentFlow: {
        type: "SUBSCRIPTION_CHECKOUT_SETUP",
        subscriptionDetails: {
          subscriptionType: "RECURRING",
          merchantSubscriptionId: "boe_sip_1",
          authWorkflowType: "TRANSACTION",
          amountType: "FIXED",
          maxAmount: 10000,
          frequency: "MONTHLY",
          productType: "UPI_MANDATE",
          expireAt: 1893456000000,
        },
      },
    })
  })

  test("normalizes setup, subscription, and accepted cancellation facts", async () => {
    const calls: string[] = []
    const httpClient: PhonePeHttpClient = (url) => {
      calls.push(url)
      if (url.endsWith("/v1/oauth/token")) {
        return Promise.resolve(response(200, { access_token: "oauth-secret", token_type: "O-Bearer", expires_at: 1893456000 }))
      }
      if (url.includes("/order/")) return Promise.resolve(response(200, {
        orderId: "provider-order",
        state: "COMPLETED",
        paymentFlow: { type: "SUBSCRIPTION_CHECKOUT_SETUP", merchantSubscriptionId: "boe_sip_1", subscriptionId: "provider-sub" },
        paymentDetails: [{ transactionId: "transaction-1", state: "COMPLETED", amount: 10000, paymentMode: "UPI_MANDATE" }],
      }))
      if (url.endsWith("/cancel")) return Promise.resolve(response(204))
      return Promise.resolve(response(200, { state: "ACTIVE", merchantSubscriptionId: "boe_sip_1", subscriptionId: "provider-sub" }))
    }
    const gateway = createPhonePeRecurringGateway({ config, httpClient })
    await expect(gateway.getSetupOrderStatus("boe_setup_1")).resolves.toMatchObject({
      state: "COMPLETED",
      merchantSubscriptionId: "boe_sip_1",
      providerSubscriptionId: "provider-sub",
    })
    await expect(gateway.getMandateStatus("boe_sip_1")).resolves.toEqual({
      state: "ACTIVE",
      merchantSubscriptionId: "boe_sip_1",
      providerSubscriptionId: "provider-sub",
    })
    await expect(gateway.cancelMandate("boe_sip_1")).resolves.toBeUndefined()
    expect(calls[1]!.endsWith("/checkout/v2/order/boe_setup_1/status?details=true")).toBe(true)
    expect(calls[2]!.endsWith("/checkout/v2/subscriptions/boe_sip_1/status")).toBe(true)
    expect(calls[3]!.endsWith("/checkout/v2/subscriptions/boe_sip_1/cancel")).toBe(true)
  })

  test("does not repeat an ambiguous setup POST", async () => {
    let setupCalls = 0
    const gateway = createPhonePeRecurringGateway({
      config,
      httpClient: (url) => {
        if (url.endsWith("/v1/oauth/token")) {
          return Promise.resolve(response(200, { access_token: "oauth-secret", token_type: "O-Bearer", expires_at: 1893456000 }))
        }
        setupCalls += 1
        return Promise.reject(new DOMException("secret", "TimeoutError"))
      },
    })
    await expect(gateway.createMandateSdkOrder({
      merchantOrderId: "boe_setup_1",
      merchantSubscriptionId: "boe_sip_1",
      amountPaise: "10000",
      expireAfterSeconds: 1200,
      mandateExpiresAt: new Date(1893456000000),
    })).rejects.toBeInstanceOf(GatewayUnavailableError)
    expect(setupCalls).toBe(1)
  })

  test("notifies an active collection with automatic standard redemption", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const gateway = createPhonePeRecurringGateway({
      config,
      httpClient: (url, init) => {
        calls.push({ url, init })
        if (url.endsWith("/v1/oauth/token")) {
          return Promise.resolve(response(200, { access_token: "oauth-secret", token_type: "O-Bearer", expires_at: 1893456000 }))
        }
        return Promise.resolve(response(200, {
          orderId: "provider-collection-order",
          state: "NOTIFICATION_IN_PROGRESS",
          expireAt: 1893456000000,
          nativeOtpEnabled: false,
        }))
      },
    })
    await expect(gateway.notifyCollection({
      merchantOrderId: "boe_due_1",
      merchantSubscriptionId: "boe_sip_1",
      amountPaise: "10000",
      expireAt: new Date(1893456000000),
    })).resolves.toEqual({
      providerOrderId: "provider-collection-order",
      providerState: "NOTIFICATION_IN_PROGRESS",
      expiresAt: new Date(1893456000000),
    })
    expect(calls[1]!.url.endsWith("/checkout/v2/subscriptions/notify")).toBe(true)
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      merchantOrderId: "boe_due_1",
      amount: 10000,
      expireAt: 1893456000000,
      paymentFlow: {
        type: "SUBSCRIPTION_CHECKOUT_REDEMPTION",
        merchantSubscriptionId: "boe_sip_1",
        redemptionRetryStrategy: "STANDARD",
        autoDebit: true,
      },
    })
  })

  test("normalizes correlated notification and terminal redemption status", async () => {
    let statusCalls = 0
    const calls: string[] = []
    const gateway = createPhonePeRecurringGateway({
      config,
      httpClient: (url) => {
        calls.push(url)
        if (url.endsWith("/v1/oauth/token")) {
          return Promise.resolve(response(200, { access_token: "oauth-secret", token_type: "O-Bearer", expires_at: 1893456000 }))
        }
        statusCalls += 1
        return Promise.resolve(response(200, statusCalls === 1 ? {
          merchantOrderId: "boe_due_1",
          orderId: "provider-collection-order",
          state: "NOTIFIED",
          currency: "INR",
          amount: 10000,
          expireAt: 1893456000000,
          paymentFlow: {
            type: "SUBSCRIPTION_CHECKOUT_REDEMPTION",
            merchantSubscriptionId: "boe_sip_1",
            redemptionRetryStrategy: "STANDARD",
            autoDebit: true,
          },
          paymentDetails: [],
        } : {
          merchantOrderId: "boe_due_1",
          orderId: "provider-collection-order",
          state: "COMPLETED",
          currency: "INR",
          amount: 10000,
          expireAt: 1893456000000,
          paymentFlow: {
            type: "SUBSCRIPTION_REDEMPTION",
            merchantSubscriptionId: "boe_sip_1",
            redemptionRetryStrategy: "STANDARD",
            autoDebit: true,
          },
          paymentDetails: [{ transactionId: "transaction-1", state: "COMPLETED", amount: 10000, paymentMode: "UPI_AUTO_PAY" }],
        }))
      },
    })
    await expect(gateway.getCollectionStatus("boe_due_1")).resolves.toMatchObject({ state: "NOTIFIED", amountPaise: "10000" })
    await expect(gateway.getCollectionStatus("boe_due_1")).resolves.toMatchObject({
      state: "COMPLETED",
      merchantSubscriptionId: "boe_sip_1",
      paymentDetails: [{ transactionId: "transaction-1", state: "COMPLETED", amountPaise: "10000" }],
    })
    expect(calls.slice(1).every((url) =>
      url.endsWith("/checkout/v2/order/boe_due_1/status?details=true"))).toBe(true)
  })

  test("does not repeat an ambiguous collection notification", async () => {
    let notifyCalls = 0
    const gateway = createPhonePeRecurringGateway({
      config,
      httpClient: (url) => {
        if (url.endsWith("/v1/oauth/token")) {
          return Promise.resolve(response(200, { access_token: "oauth-secret", token_type: "O-Bearer", expires_at: 1893456000 }))
        }
        notifyCalls += 1
        return Promise.reject(new DOMException("secret", "TimeoutError"))
      },
    })
    await expect(gateway.notifyCollection({
      merchantOrderId: "boe_due_1",
      merchantSubscriptionId: "boe_sip_1",
      amountPaise: "10000",
      expireAt: new Date(1893456000000),
    })).rejects.toBeInstanceOf(GatewayUnavailableError)
    expect(notifyCalls).toBe(1)
  })
})
