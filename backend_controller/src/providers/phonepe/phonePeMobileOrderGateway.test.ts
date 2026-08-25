import { describe, expect, test } from "vitest"

import { GatewayMalformedResponseError, GatewayUnavailableError } from "./paymentGateway.js"
import { classifyGatewayFailure } from "./gatewayFailure.js"
import { createPhonePeMobileOrderGateway, type PhonePeHttpClient } from "./phonePeMobileOrderGateway.js"

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const requestBody = (init: RequestInit): string => {
  if (typeof init.body !== "string") throw new Error("expected a string request body")
  return init.body
}

describe("PhonePe mobile SDK order gateway", () => {
  test("uses OAuth and creates only a UPI Intent SDK order", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const httpClient: PhonePeHttpClient = (url, init) => {
      calls.push({ url, init })
      if (url.endsWith("/v1/oauth/token")) {
        return Promise.resolve(response(200, { access_token: "oauth-secret", token_type: "O-Bearer", expires_at: 1893456000 }))
      }
      return Promise.resolve(response(200, {
        orderId: "phonepe-order-1",
        state: "PENDING",
        expireAt: 1893456000000,
        token: "sdk-secret",
      }))
    }
    const gateway = createPhonePeMobileOrderGateway({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        clientVersion: "1",
        env: "sandbox",
        requestTimeoutMs: 5_000,
      },
      httpClient,
    })

    const created = await gateway.createSdkOrder({
      merchantOrderId: "boe_0123456789abcdef0123456789abcdef",
      amountPaise: "10000",
      expireAfterSeconds: 1200,
    })

    expect(created).toEqual({
      providerOrderId: "phonepe-order-1",
      providerState: "PENDING",
      sdkToken: "sdk-secret",
      expiresAt: new Date(1893456000000),
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toBe("https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token")
    expect(calls[0]!.init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" })
    expect(requestBody(calls[0]!.init)).toBe(
      "client_id=client-id&client_version=1&client_secret=client-secret&grant_type=client_credentials",
    )
    expect(calls[1]!.url).toBe("https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/sdk/order")
    expect(calls[1]!.init.headers).toEqual({
      Accept: "application/json",
      Authorization: "O-Bearer oauth-secret",
      "Content-Type": "application/json",
    })
    expect(JSON.parse(requestBody(calls[1]!.init))).toEqual({
      merchantOrderId: "boe_0123456789abcdef0123456789abcdef",
      amount: 10000,
      expireAfter: 1200,
      paymentFlow: {
        type: "PG_CHECKOUT",
        paymentModeConfig: { enabledPaymentModes: [{ type: "UPI_INTENT" }] },
      },
    })
    expect(JSON.stringify(calls[1]!.init)).not.toContain("client-secret")
  })

  test("maps ambiguous transport failure and malformed success without leaking tokens", async () => {
    const failing = createPhonePeMobileOrderGateway({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        clientVersion: "1",
        env: "production",
        requestTimeoutMs: 5_000,
      },
      httpClient: () => Promise.reject(new Error("sdk-secret oauth-secret")),
    })
    await expect(failing.createSdkOrder({
      merchantOrderId: "boe_1",
      amountPaise: "10000",
      expireAfterSeconds: 1200,
    })).rejects.toMatchObject({
      constructor: GatewayUnavailableError,
      message: "the provider call failed; retry later",
    })

    let call = 0
    const malformed = createPhonePeMobileOrderGateway({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        clientVersion: "1",
        env: "production",
        requestTimeoutMs: 5_000,
      },
      httpClient: () => {
        call += 1
        return Promise.resolve(call === 1
          ? response(200, { access_token: "oauth-secret", token_type: "O-Bearer", expires_at: 1893456000 })
          : response(200, { orderId: "phonepe-order-1", state: "PENDING", expireAt: 1893456000000 }))
      },
    })
    await expect(malformed.createSdkOrder({
      merchantOrderId: "boe_1",
      amountPaise: "10000",
      expireAfterSeconds: 1200,
    })).rejects.toBeInstanceOf(GatewayMalformedResponseError)

    let providerCall = 0
    const unavailable = createPhonePeMobileOrderGateway({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        clientVersion: "1",
        env: "production",
        requestTimeoutMs: 5_000,
      },
      httpClient: () => {
        providerCall += 1
        return Promise.resolve(providerCall === 1
          ? response(200, { access_token: "oauth-secret", token_type: "O-Bearer", expires_at: 1893456000 })
          : response(503, { token: "must-not-leak" }))
      },
    })
    const providerError = await unavailable.createSdkOrder({
      merchantOrderId: "boe_1",
      amountPaise: "10000",
      expireAfterSeconds: 1200,
    }).catch((error: unknown) => error)
    expect(classifyGatewayFailure(providerError)).toBe("provider_5xx")

    const timeout = new DOMException("sdk-secret", "TimeoutError")
    const timedOut = createPhonePeMobileOrderGateway({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        clientVersion: "1",
        env: "production",
        requestTimeoutMs: 5_000,
      },
      httpClient: () => Promise.reject(timeout),
    })
    const timeoutError = await timedOut.createSdkOrder({
      merchantOrderId: "boe_1",
      amountPaise: "10000",
      expireAfterSeconds: 1200,
    }).catch((error: unknown) => error)
    expect(classifyGatewayFailure(timeoutError)).toBe("provider_timeout")
  })

  test("rejects OAuth grants unless they are exact O-Bearer grants valid beyond refresh skew", async () => {
    const command = { merchantOrderId: "boe_1", amountPaise: "10000", expireAfterSeconds: 1200 }
    let invalidTypeCalls = 0
    const invalidType = createPhonePeMobileOrderGateway({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        clientVersion: "1",
        env: "production",
        requestTimeoutMs: 5_000,
      },
      clock: () => new Date("2026-08-24T12:00:00.000Z"),
      httpClient: () => {
        invalidTypeCalls += 1
        return Promise.resolve(response(200, {
          access_token: "oauth-secret",
          token_type: "Bearer",
          expires_at: 1893456000,
        }))
      },
    })
    let staleCalls = 0
    const stale = createPhonePeMobileOrderGateway({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        clientVersion: "1",
        env: "production",
        requestTimeoutMs: 5_000,
      },
      clock: () => new Date("2026-08-24T12:00:00.000Z"),
      httpClient: () => {
        staleCalls += 1
        return Promise.resolve(response(200, {
          access_token: "oauth-secret",
          token_type: "O-Bearer",
          expires_at: 1787572830,
        }))
      },
    })

    await expect(invalidType.createSdkOrder(command)).rejects.toBeInstanceOf(GatewayMalformedResponseError)
    await expect(stale.createSdkOrder(command)).rejects.toBeInstanceOf(GatewayMalformedResponseError)
    expect(invalidTypeCalls).toBe(1)
    expect(staleCalls).toBe(1)
  })

  test("shares OAuth requests and performs one shared refresh after concurrent authorization failures", async () => {
    let oauthCalls = 0
    let orderCalls = 0
    const gateway = createPhonePeMobileOrderGateway({
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        clientVersion: "1",
        env: "production",
        requestTimeoutMs: 5_000,
      },
      httpClient: async (url) => {
        if (url.endsWith("/v1/oauth/token")) {
          oauthCalls += 1
          await Promise.resolve()
          return response(200, {
            access_token: `oauth-secret-${oauthCalls}`,
            token_type: "O-Bearer",
            expires_at: 1893456000,
          })
        }
        expect(url).toBe("https://api.phonepe.com/apis/pg/checkout/v2/sdk/order")
        orderCalls += 1
        if (orderCalls <= 2) return response(401, {})
        return response(200, {
          orderId: `phonepe-order-${orderCalls}`,
          state: "PENDING",
          expireAt: 1893456000000,
          token: `sdk-secret-${orderCalls}`,
        })
      },
    })

    await Promise.all([
      gateway.createSdkOrder({ merchantOrderId: "boe_1", amountPaise: "10000", expireAfterSeconds: 1200 }),
      gateway.createSdkOrder({ merchantOrderId: "boe_2", amountPaise: "10000", expireAfterSeconds: 1200 }),
    ])

    expect(oauthCalls).toBe(2)
    expect(orderCalls).toBe(4)
  })
})
