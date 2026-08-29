import { describe, expect, it } from "vitest"

import {
  GatewayMalformedResponseError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
} from "../phonepe/paymentGateway.js"
import { createRelayPaymentGateway } from "./relayPaymentGateway.js"
import type { RelayHttpClient } from "./relayPaymentGateway.js"
import { signRelayRequest } from "./relayServiceAuth.js"

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef"
const NOW = new Date("2026-09-01T10:00:00.000Z")

const CONFIG = {
  baseUrl: "http://boe-payment-service:47430",
  service: "boe-dev",
  secret: SECRET,
} as const

const envelope = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  })

const build = (respond: RelayHttpClient) => {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = []
  const httpClient: RelayHttpClient = async (url, init) => {
    calls.push({ url, headers: { ...init.headers }, body: init.body })
    return respond(url, init)
  }
  const gateway = createRelayPaymentGateway({
    config: CONFIG,
    httpClient,
    now: () => NOW,
    nonce: () => "fixed-nonce",
  })
  return { gateway, calls }
}

const checkoutOk = () =>
  envelope({
    state: "CHECKOUT_CREATED",
    merchantOrderId: "boe-dev_ORDER-1",
    checkoutUrl: "https://mercury-t2.phonepe.com/transact/pgv3?token=abc",
    providerReference: "OMO1",
    expiresAt: "2026-09-01T10:15:00.000Z",
  })

describe("relay payment gateway", () => {
  it("creates a checkout and maps the service envelope onto the port's type", async () => {
    const { gateway } = build(async () => checkoutOk())

    await expect(gateway.createCheckout({
      merchantOrderId: "boe-dev_ORDER-1",
      amountPaise: "100",
      redirectUrl: null,
      expireAfterSeconds: 900,
    })).resolves.toStrictEqual({
      redirectUrl: "https://mercury-t2.phonepe.com/transact/pgv3?token=abc",
      providerOrderId: "OMO1",
      expiresAt: new Date("2026-09-01T10:15:00.000Z"),
    })
  })

  it("signs the request over the exact path and body", async () => {
    const { gateway, calls } = build(async () => checkoutOk())
    await gateway.createCheckout({
      merchantOrderId: "boe-dev_ORDER-1",
      amountPaise: "100",
      redirectUrl: null,
      expireAfterSeconds: 900,
    })

    const call = calls[0]
    expect(call?.url).toBe("http://boe-payment-service:47430/internal/v1/payments/checkout")
    expect(call?.headers["x-boe-service"]).toBe("boe-dev")
    expect(call?.headers["x-boe-signature"]).toBe(signRelayRequest(
      SECRET,
      "POST",
      "/internal/v1/payments/checkout",
      String(NOW.getTime()),
      "fixed-nonce",
      call?.body ?? "",
    ))
  })

  it("never sends a redirect URL, so the service always chooses the approved host", async () => {
    const { gateway, calls } = build(async () => checkoutOk())
    await gateway.createCheckout({
      merchantOrderId: "boe-dev_ORDER-1",
      amountPaise: "100",
      redirectUrl: "https://dev-app.beonedge.in/dashboard",
      expireAfterSeconds: 900,
    })

    expect(JSON.parse(calls[0]?.body ?? "{}")).toStrictEqual({
      merchantOrderId: "boe-dev_ORDER-1",
      amountPaise: "100",
      expireAfterSeconds: 900,
    })
  })

  it("passes merchantOrderId through untouched", async () => {
    const { gateway, calls } = build(async () => checkoutOk())
    await gateway.createCheckout({
      merchantOrderId: "boe-dev_ORDER-weird_id-42",
      amountPaise: "100",
      redirectUrl: null,
      expireAfterSeconds: 900,
    })

    expect((JSON.parse(calls[0]?.body ?? "{}") as { merchantOrderId?: string }).merchantOrderId)
      .toBe("boe-dev_ORDER-weird_id-42")
  })

  it("maps normalized status back onto the port's outcome vocabulary", async () => {
    for (const [status, outcome] of [["SUCCESS", "succeeded"], ["FAILED", "failed"], ["PENDING", "pending"]]) {
      const { gateway } = build(async () => envelope({
        merchantOrderId: "boe-dev_ORDER-1",
        status,
        providerState: "COMPLETED",
        providerReference: "OMO1",
        amountPaise: "100",
        currency: "INR",
        details: [],
      }))
      await expect(gateway.getOrderStatus("boe-dev_ORDER-1"))
        .resolves.toMatchObject({ outcome })
    }
  })

  it("never promotes an unrecognised status to success", async () => {
    const { gateway } = build(async () => envelope({
      status: "WHO_KNOWS",
      providerState: "ODD",
      details: [],
    }))

    await expect(gateway.getOrderStatus("boe-dev_ORDER-1")).resolves.toMatchObject({
      outcome: "pending",
    })
  })

  it("keeps payment details as evidence", async () => {
    const { gateway } = build(async () => envelope({
      status: "SUCCESS",
      providerState: "COMPLETED",
      details: [
        { transactionId: "T1", reference: "R1", instrumentType: "UPI", state: "COMPLETED", amountPaise: "100" },
        { reference: "no-transaction-id" },
      ],
    }))

    const fact = await gateway.getOrderStatus("boe-dev_ORDER-1")
    expect(fact.details).toHaveLength(1)
    expect(fact.details[0]?.transactionId).toBe("T1")
  })

  it("treats an unreachable service as retryable", async () => {
    const { gateway } = build(async () => {
      throw new Error("ECONNREFUSED")
    })

    await expect(gateway.getOrderStatus("boe-dev_ORDER-1"))
      .rejects.toBeInstanceOf(GatewayUnavailableError)
  })

  it("treats a rejected service credential as non-retryable", async () => {
    for (const status of [401, 403]) {
      const { gateway } = build(async () => new Response("{}", { status }))
      await expect(gateway.getOrderStatus("boe-dev_ORDER-1"))
        .rejects.toBeInstanceOf(GatewayRejectedError)
    }
  })

  it("maps 404 to not found and 5xx to unavailable", async () => {
    const missing = build(async () => new Response("{}", { status: 404 }))
    await expect(missing.gateway.getOrderStatus("x")).rejects.toBeInstanceOf(GatewayNotFoundError)

    const broken = build(async () => new Response("{}", { status: 502 }))
    await expect(broken.gateway.getOrderStatus("x")).rejects.toBeInstanceOf(GatewayUnavailableError)
  })

  it("refuses an envelope it cannot trust", async () => {
    for (const payload of ['{"ok":false,"data":{}}', '{"ok":true}', "not json"]) {
      const { gateway } = build(async () => new Response(payload, {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      await expect(gateway.getOrderStatus("x")).rejects.toBeInstanceOf(GatewayMalformedResponseError)
    }
  })

  it("refuses a checkout response missing the URL", async () => {
    const { gateway } = build(async () => envelope({ providerReference: "OMO1" }))

    await expect(gateway.createCheckout({
      merchantOrderId: "boe-dev_ORDER-1",
      amountPaise: "100",
      redirectUrl: null,
      expireAfterSeconds: 900,
    })).rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })

  it("refuses to verify provider callbacks, because that is the service's job now", () => {
    const { gateway } = build(async () => checkoutOk())

    expect(() => gateway.validateShaCallback("sha256-x", "{}")).toThrow(GatewayRejectedError)
  })

  it("initiates a refund and reads its status", async () => {
    const initiated = build(async () => envelope({
      merchantRefundId: "BOE-REFUND-1",
      status: "PENDING",
      providerState: "PENDING",
      providerReference: "PR1",
    }))
    await expect(initiated.gateway.initiateRefund({
      merchantRefundId: "BOE-REFUND-1",
      originalMerchantOrderId: "boe-dev_ORDER-1",
      amountPaise: "100",
    })).resolves.toStrictEqual({
      providerRefundId: "PR1",
      outcome: "pending",
      providerState: "PENDING",
    })

    const status = build(async () => envelope({
      merchantRefundId: "BOE-REFUND-1",
      originalMerchantOrderId: "boe-dev_ORDER-1",
      status: "SUCCESS",
      providerState: "COMPLETED",
      providerReference: "PR1",
      amountPaise: "100",
    }))
    await expect(status.gateway.getRefundStatus("BOE-REFUND-1"))
      .resolves.toMatchObject({ outcome: "succeeded", providerRefundId: "PR1" })
  })

  it("uses a fresh nonce per request when none is injected", async () => {
    const seen = new Set<string>()
    const gateway = createRelayPaymentGateway({
      config: CONFIG,
      httpClient: async (_url, init) => {
        seen.add(init.headers["x-boe-nonce"] ?? "")
        return envelope({ status: "PENDING", providerState: "P", details: [] })
      },
      now: () => NOW,
    })

    await gateway.getOrderStatus("a")
    await gateway.getOrderStatus("b")
    expect(seen.size).toBe(2)
  })
})
