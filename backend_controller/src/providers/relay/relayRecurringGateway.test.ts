import { describe, expect, it } from "vitest"

import {
  GatewayMalformedResponseError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
} from "../phonepe/paymentGateway.js"
import type { RelayHttpClient } from "./relayPaymentGateway.js"
import { createRelayRecurringGateway } from "./relayRecurringGateway.js"

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef"
const NOW = new Date("2026-09-01T10:00:00.000Z")

const CONFIG = {
  baseUrl: "http://boe-payment-service:47430",
  service: "boe-dev",
  secret: SECRET,
} as const

const envelope = (data: unknown): Response =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

const build = (respond: RelayHttpClient) => {
  const calls: Array<{ url: string; body: string }> = []
  const gateway = createRelayRecurringGateway({
    config: CONFIG,
    httpClient: async (url, init) => {
      calls.push({ url, body: init.body })
      return respond(url, init)
    },
    now: () => NOW,
    nonce: () => "fixed",
  })
  return { gateway, calls }
}

const MANDATE_OK = {
  state: "MANDATE_CHECKOUT_CREATED",
  merchantOrderId: "boe-dev_SETUP-1",
  checkoutUrl: "https://www.beonedge.in/pay/start?t=abc",
  providerReference: "OMO-M1",
  providerState: "PENDING",
  expiresAt: "2026-09-01T10:15:00.000Z",
}

describe("relay recurring gateway", () => {
  it("creates a mandate checkout and maps it onto the port's type", async () => {
    const { gateway } = build(async () => envelope(MANDATE_OK))

    await expect(gateway.createMandateCheckout({
      merchantOrderId: "boe-dev_SETUP-1",
      merchantSubscriptionId: "boe-dev_SUB-1",
      amountPaise: "100",
      expireAfterSeconds: 900,
      mandateExpiresAt: new Date("2027-09-01T10:00:00.000Z"),
      redirectUrl: "https://ignored.example/",
    })).resolves.toStrictEqual({
      providerOrderId: "OMO-M1",
      providerState: "PENDING",
      redirectUrl: "https://www.beonedge.in/pay/start?t=abc",
      expiresAt: new Date("2026-09-01T10:15:00.000Z"),
    })
  })

  it("does not send the caller's redirect URL, so the service picks the approved host", async () => {
    const { gateway, calls } = build(async () => envelope(MANDATE_OK))
    await gateway.createMandateCheckout({
      merchantOrderId: "boe-dev_SETUP-1",
      merchantSubscriptionId: "boe-dev_SUB-1",
      amountPaise: "100",
      expireAfterSeconds: 900,
      mandateExpiresAt: new Date("2027-09-01T10:00:00.000Z"),
      redirectUrl: "https://dev-app.beonedge.in/dashboard",
    })

    const sent = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>
    expect(sent).not.toHaveProperty("redirectUrl")
    expect(sent.mandateExpiresAt).toBe("2027-09-01T10:00:00.000Z")
  })

  it("reads setup status and keeps payment details", async () => {
    const { gateway } = build(async () => envelope({
      state: "COMPLETED",
      providerOrderId: "OMO-M1",
      merchantSubscriptionId: "boe-dev_SUB-1",
      providerSubscriptionId: "PSUB1",
      paymentDetails: [
        { transactionId: "T1", state: "COMPLETED", amountPaise: "100", instrumentType: "UPI" },
        { state: "no transaction id" },
      ],
    }))

    const status = await gateway.getSetupOrderStatus("boe-dev_SETUP-1")
    expect(status.state).toBe("COMPLETED")
    expect(status.paymentDetails).toHaveLength(1)
    expect(status.paymentDetails[0]?.transactionId).toBe("T1")
  })

  it("refuses a setup state it does not recognise rather than guessing", async () => {
    const { gateway } = build(async () => envelope({
      state: "PROBABLY_FINE",
      merchantSubscriptionId: "boe-dev_SUB-1",
    }))

    await expect(gateway.getSetupOrderStatus("boe-dev_SETUP-1"))
      .rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })

  it("accepts every documented mandate state and rejects anything else", async () => {
    for (const state of [
      "ACTIVATION_IN_PROGRESS", "ACTIVE", "EXPIRED", "FAILED", "CANCEL_IN_PROGRESS",
      "CANCELLED", "REVOKE_IN_PROGRESS", "REVOKED", "PAUSE_IN_PROGRESS", "PAUSED",
      "UNPAUSE_IN_PROGRESS",
    ]) {
      const { gateway } = build(async () => envelope({
        state,
        merchantSubscriptionId: "boe-dev_SUB-1",
        providerSubscriptionId: "PSUB1",
      }))
      await expect(gateway.getMandateStatus("boe-dev_SUB-1")).resolves.toMatchObject({ state })
    }

    const { gateway } = build(async () => envelope({
      state: "ACTIVE_ISH",
      merchantSubscriptionId: "boe-dev_SUB-1",
    }))
    await expect(gateway.getMandateStatus("boe-dev_SUB-1"))
      .rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })

  it("notifies a collection and reads its status", async () => {
    const notify = build(async () => envelope({
      state: "COLLECTION_NOTIFIED",
      merchantOrderId: "boe-dev_COL-1",
      providerReference: "OMO-C1",
      providerState: "NOTIFICATION_IN_PROGRESS",
      expiresAt: "2026-09-02T10:00:00.000Z",
    }))
    await expect(notify.gateway.notifyCollection({
      merchantOrderId: "boe-dev_COL-1",
      merchantSubscriptionId: "boe-dev_SUB-1",
      amountPaise: "100",
      expireAt: new Date("2026-09-02T10:00:00.000Z"),
    })).resolves.toStrictEqual({
      providerOrderId: "OMO-C1",
      providerState: "NOTIFICATION_IN_PROGRESS",
      expiresAt: new Date("2026-09-02T10:00:00.000Z"),
    })

    const status = build(async () => envelope({
      state: "NOTIFIED",
      merchantOrderId: "boe-dev_COL-1",
      providerOrderId: "OMO-C1",
      merchantSubscriptionId: "boe-dev_SUB-1",
      amountPaise: "100",
      expiresAt: "2026-09-02T10:00:00.000Z",
      paymentDetails: [],
    }))
    await expect(status.gateway.getCollectionStatus("boe-dev_COL-1"))
      .resolves.toMatchObject({ state: "NOTIFIED", amountPaise: "100" })
  })

  it("refuses an unusable expiry rather than inventing one", async () => {
    const { gateway } = build(async () => envelope({
      state: "NOTIFIED",
      merchantOrderId: "boe-dev_COL-1",
      merchantSubscriptionId: "boe-dev_SUB-1",
      amountPaise: "100",
      expiresAt: "not a date",
      paymentDetails: [],
    }))

    await expect(gateway.getCollectionStatus("boe-dev_COL-1"))
      .rejects.toBeInstanceOf(GatewayMalformedResponseError)
  })

  it("cancels a mandate", async () => {
    const { gateway, calls } = build(async () => envelope({
      state: "CANCEL_REQUESTED",
      merchantSubscriptionId: "boe-dev_SUB-1",
    }))

    await expect(gateway.cancelMandate("boe-dev_SUB-1")).resolves.toBeUndefined()
    expect(calls[0]?.url).toBe("http://boe-payment-service:47430/internal/v1/autopay/mandates/cancel")
  })

  it("maps transport failures onto the same vocabulary as the direct adapter", async () => {
    const down = build(async () => {
      throw new Error("ECONNREFUSED")
    })
    await expect(down.gateway.getMandateStatus("s")).rejects.toBeInstanceOf(GatewayUnavailableError)

    const refused = build(async () => new Response("{}", { status: 401 }))
    await expect(refused.gateway.getMandateStatus("s")).rejects.toBeInstanceOf(GatewayRejectedError)

    const missing = build(async () => new Response("{}", { status: 404 }))
    await expect(missing.gateway.getMandateStatus("s")).rejects.toBeInstanceOf(GatewayNotFoundError)

    const broken = build(async () => new Response("{}", { status: 503 }))
    await expect(broken.gateway.getMandateStatus("s")).rejects.toBeInstanceOf(GatewayUnavailableError)
  })

  it("refuses an envelope it cannot trust", async () => {
    for (const payload of ['{"ok":false,"data":{}}', '{"ok":true}', "nonsense"]) {
      const { gateway } = build(async () => new Response(payload, {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      await expect(gateway.getMandateStatus("s")).rejects.toBeInstanceOf(GatewayMalformedResponseError)
    }
  })
})
