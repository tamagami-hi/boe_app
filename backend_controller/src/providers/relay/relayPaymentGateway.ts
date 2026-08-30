import {
  GatewayMalformedResponseError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
} from "../phonepe/paymentGateway.js"
import type {
  CheckoutCreated,
  CreateCheckoutCommand,
  InitiateRefundCommand,
  OrderStatusFact,
  PaymentGateway,
  ProviderOutcome,
  ProviderPaymentDetailFact,
  RefundInitiated,
  RefundStatusFact,
} from "../phonepe/paymentGateway.js"
import { relayRequestHeaders } from "./relayServiceAuth.js"

export interface RelayGatewayConfig {
  readonly baseUrl: string
  readonly service: string
  readonly secret: string
  readonly requestTimeoutMs?: number
}

export type RelayHttpClient = (
  url: string,
  init: Readonly<{ method: string; headers: Readonly<Record<string, string>>; body: string; signal: AbortSignal }>,
) => Promise<Response>

export interface RelayGatewayDeps {
  readonly config: RelayGatewayConfig
  readonly httpClient?: RelayHttpClient
  readonly now?: () => Date
  readonly nonce?: () => string
}

const PATHS = Object.freeze({
  checkout: "/internal/v1/payments/checkout",
  status: "/internal/v1/payments/status",
  refund: "/internal/v1/payments/refund",
  refundStatus: "/internal/v1/payments/refund-status",
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const requiredString = (value: unknown, field: string): string => {
  const found = optionalString(value)
  if (found === null) {
    throw new GatewayMalformedResponseError(`the payment service omitted ${field}`)
  }
  return found
}

const OUTCOMES: Readonly<Record<string, ProviderOutcome>> = Object.freeze({
  SUCCESS: "succeeded",
  FAILED: "failed",
  PENDING: "pending",
})

const outcomeOf = (value: unknown): ProviderOutcome => {
  const found = optionalString(value)
  if (found === null) return "pending"
  return OUTCOMES[found] ?? "pending"
}

const detailsOf = (value: unknown): readonly ProviderPaymentDetailFact[] => {
  if (!Array.isArray(value)) return []
  const details: ProviderPaymentDetailFact[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const transactionId = optionalString(entry.transactionId)
    if (transactionId === null) continue
    details.push(Object.freeze({
      transactionId,
      reference: optionalString(entry.reference),
      instrumentType: optionalString(entry.instrumentType),
      state: optionalString(entry.state),
      amountPaise: optionalString(entry.amountPaise),
    }))
  }
  return Object.freeze(details)
}

export const createRelayPaymentGateway = (deps: RelayGatewayDeps): PaymentGateway => {
  const { config } = deps
  const now = deps.now ?? ((): Date => new Date())
  const timeoutMs = config.requestTimeoutMs ?? 10_000
  const http: RelayHttpClient = deps.httpClient
    ?? ((url, init) => fetch(url, init))

  const call = async (path: string, payload: unknown): Promise<Record<string, unknown>> => {
    const body = JSON.stringify(payload)
    const headers = relayRequestHeaders(
      {
        service: config.service,
        secret: config.secret,
        now,
        ...(deps.nonce === undefined ? {} : { nonce: deps.nonce }),
      },
      "POST",
      path,
      body,
    )
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    let response: Response
    try {
      response = await http(`${config.baseUrl}${path}`, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      })
    } catch (error) {
      throw new GatewayUnavailableError("the payment service could not be reached", { cause: error })
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 404) {
      throw new GatewayNotFoundError("the payment service reported no such record")
    }
    if (response.status === 401 || response.status === 403) {
      throw new GatewayRejectedError("the payment service refused our service credentials")
    }
    if (response.status === 400 || response.status === 422) {
      throw new GatewayRejectedError("the payment service rejected the request")
    }
    if (!response.ok) {
      throw new GatewayUnavailableError(`the payment service answered ${String(response.status)}`)
    }

    let decoded: unknown
    try {
      decoded = await response.json()
    } catch (error) {
      throw new GatewayMalformedResponseError("the payment service returned no JSON", { cause: error })
    }
    if (!isRecord(decoded) || decoded.ok !== true || !isRecord(decoded.data)) {
      throw new GatewayMalformedResponseError("the payment service returned an unusable envelope")
    }
    return decoded.data
  }

  return Object.freeze({
    createCheckout: async (command: CreateCheckoutCommand): Promise<CheckoutCreated> => {
      const data = await call(PATHS.checkout, {
        merchantOrderId: command.merchantOrderId,
        amountPaise: command.amountPaise,
        expireAfterSeconds: command.expireAfterSeconds,
      })
      const expiresAtRaw = optionalString(data.expiresAt)
      const expiresAt = expiresAtRaw === null ? null : new Date(expiresAtRaw)
      return {
        redirectUrl: requiredString(data.checkoutUrl, "checkoutUrl"),
        providerOrderId: requiredString(data.providerReference, "providerReference"),
        expiresAt: expiresAt !== null && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
      }
    },

    getOrderStatus: async (merchantOrderId: string): Promise<OrderStatusFact> => {
      const data = await call(PATHS.status, { merchantOrderId })
      return {
        merchantOrderId: optionalString(data.merchantOrderId),
        outcome: outcomeOf(data.status),
        providerState: requiredString(data.providerState, "providerState"),
        providerOrderId: optionalString(data.providerReference),
        amountPaise: optionalString(data.amountPaise),
        currency: optionalString(data.currency),
        details: detailsOf(data.details),
      }
    },

    initiateRefund: async (command: InitiateRefundCommand): Promise<RefundInitiated> => {
      const data = await call(PATHS.refund, {
        merchantRefundId: command.merchantRefundId,
        originalMerchantOrderId: command.originalMerchantOrderId,
        amountPaise: command.amountPaise,
      })
      return {
        providerRefundId: optionalString(data.providerReference),
        outcome: outcomeOf(data.status),
        providerState: requiredString(data.providerState, "providerState"),
      }
    },

    getRefundStatus: async (merchantRefundId: string): Promise<RefundStatusFact> => {
      const data = await call(PATHS.refundStatus, { merchantRefundId })
      return {
        merchantRefundId: optionalString(data.merchantRefundId) ?? merchantRefundId,
        providerRefundId: optionalString(data.providerReference),
        originalMerchantOrderId: optionalString(data.originalMerchantOrderId),
        amountPaise: optionalString(data.amountPaise),
        outcome: outcomeOf(data.status),
        providerState: requiredString(data.providerState, "providerState"),
      }
    },
  })
}
