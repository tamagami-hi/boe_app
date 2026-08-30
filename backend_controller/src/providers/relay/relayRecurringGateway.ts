import {
  GatewayMalformedResponseError,
  GatewayCredentialError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayThrottledError,
  GatewayUnavailableError,
} from "../paymentGateway.js"
import type {
  CollectionNotificationResult,
  CollectionStatus,
  CreateMandateCheckoutCommand,
  MandateCheckoutCreated,
  MandateSetupStatus,
  MandateStatus,
  NotifyCollectionCommand,
  ProviderMandateState,
  ProviderPaymentDetail,
  RecurringPaymentGateway,
} from "../recurringPaymentGateway.js"

import { relayRequestHeaders } from "./relayServiceAuth.js"
import type { RelayGatewayConfig, RelayHttpClient } from "./relayPaymentGateway.js"

export interface RelayRecurringDeps {
  readonly config: RelayGatewayConfig
  readonly httpClient?: RelayHttpClient
  readonly now?: () => Date
  readonly nonce?: () => string
}

const PATHS = Object.freeze({
  mandate: "/internal/v1/autopay/mandates",
  setupStatus: "/internal/v1/autopay/mandates/setup-status",
  mandateStatus: "/internal/v1/autopay/mandates/status",
  cancel: "/internal/v1/autopay/mandates/cancel",
  collection: "/internal/v1/autopay/collections",
  collectionStatus: "/internal/v1/autopay/collections/status",
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const requiredString = (value: unknown, field: string): string => {
  const found = optionalString(value)
  if (found === null) throw new GatewayMalformedResponseError(`the payment service omitted ${field}`)
  return found
}

const requiredDate = (value: unknown, field: string): Date => {
  const parsed = new Date(requiredString(value, field))
  if (!Number.isFinite(parsed.getTime())) {
    throw new GatewayMalformedResponseError(`the payment service sent an unusable ${field}`)
  }
  return parsed
}

const SETUP_STATES = new Set(["PENDING", "FAILED", "COMPLETED"])

const MANDATE_STATES = new Set<ProviderMandateState>([
  "ACTIVATION_IN_PROGRESS", "ACTIVE", "EXPIRED", "FAILED",
  "CANCEL_IN_PROGRESS", "CANCELLED", "REVOKE_IN_PROGRESS", "REVOKED",
  "PAUSE_IN_PROGRESS", "PAUSED", "UNPAUSE_IN_PROGRESS",
])

const COLLECTION_STATES = new Set([
  "NOTIFICATION_IN_PROGRESS", "NOTIFIED", "PENDING", "COMPLETED", "FAILED",
])

const detailsOf = (value: unknown): readonly ProviderPaymentDetail[] => {
  if (!Array.isArray(value)) return []
  const details: ProviderPaymentDetail[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const transactionId = optionalString(entry.transactionId)
    const state = optionalString(entry.state)
    if (transactionId === null || state === null) continue
    details.push(Object.freeze({
      transactionId,
      state,
      amountPaise: optionalString(entry.amountPaise),
      instrumentType: optionalString(entry.instrumentType),
    }))
  }
  return Object.freeze(details)
}

export const createRelayRecurringGateway = (deps: RelayRecurringDeps): RecurringPaymentGateway => {
  const { config } = deps
  const now = deps.now ?? ((): Date => new Date())
  const timeoutMs = config.requestTimeoutMs ?? 10_000
  const http: RelayHttpClient = deps.httpClient ?? ((url, init) => fetch(url, init))

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

    if (response.status === 404) throw new GatewayNotFoundError("no such mandate or collection")
    if (response.status === 401 || response.status === 403) {
      throw new GatewayRejectedError("the payment service refused our service credentials")
    }
    if (response.status === 400 || response.status === 422) {
      throw new GatewayRejectedError("the payment service rejected the request")
    }
    if (response.status === 429) {
      throw new GatewayThrottledError("the payment service reported provider throttling")
    }
    if (response.status === 502) {
      throw new GatewayCredentialError("the provider rejected the payment service's credentials")
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
    createMandateCheckout: async (
      command: CreateMandateCheckoutCommand,
    ): Promise<MandateCheckoutCreated> => {
      const data = await call(PATHS.mandate, {
        merchantOrderId: command.merchantOrderId,
        merchantSubscriptionId: command.merchantSubscriptionId,
        amountPaise: command.amountPaise,
        expireAfterSeconds: command.expireAfterSeconds,
        mandateExpiresAt: command.mandateExpiresAt.toISOString(),
      })
      return {
        providerOrderId: requiredString(data.providerReference, "providerReference"),
        providerState: "PENDING",
        redirectUrl: requiredString(data.checkoutUrl, "checkoutUrl"),
        expiresAt: requiredDate(data.expiresAt, "expiresAt"),
      }
    },

    getSetupOrderStatus: async (merchantOrderId: string): Promise<MandateSetupStatus> => {
      const data = await call(PATHS.setupStatus, { merchantOrderId })
      const state = requiredString(data.state, "state")
      if (!SETUP_STATES.has(state)) {
        throw new GatewayMalformedResponseError(`unrecognised setup state ${state}`)
      }
      return {
        state: state as MandateSetupStatus["state"],
        providerOrderId: optionalString(data.providerOrderId),
        merchantSubscriptionId: requiredString(data.merchantSubscriptionId, "merchantSubscriptionId"),
        providerSubscriptionId: optionalString(data.providerSubscriptionId),
        paymentDetails: detailsOf(data.paymentDetails),
      }
    },

    getMandateStatus: async (merchantSubscriptionId: string): Promise<MandateStatus> => {
      const data = await call(PATHS.mandateStatus, { merchantSubscriptionId })
      const state = requiredString(data.state, "state")
      if (!MANDATE_STATES.has(state as ProviderMandateState)) {
        throw new GatewayMalformedResponseError(`unrecognised mandate state ${state}`)
      }
      return {
        state: state as ProviderMandateState,
        merchantSubscriptionId: optionalString(data.merchantSubscriptionId) ?? merchantSubscriptionId,
        providerSubscriptionId: optionalString(data.providerSubscriptionId),
      }
    },

    notifyCollection: async (
      command: NotifyCollectionCommand,
    ): Promise<CollectionNotificationResult> => {
      const data = await call(PATHS.collection, {
        merchantOrderId: command.merchantOrderId,
        merchantSubscriptionId: command.merchantSubscriptionId,
        amountPaise: command.amountPaise,
        expireAt: command.expireAt.toISOString(),
      })
      return {
        providerOrderId: requiredString(data.providerReference, "providerReference"),
        providerState: "NOTIFICATION_IN_PROGRESS",
        expiresAt: requiredDate(data.expiresAt, "expiresAt"),
      }
    },

    getCollectionStatus: async (merchantOrderId: string): Promise<CollectionStatus> => {
      const data = await call(PATHS.collectionStatus, { merchantOrderId })
      const state = requiredString(data.state, "state")
      if (!COLLECTION_STATES.has(state)) {
        throw new GatewayMalformedResponseError(`unrecognised collection state ${state}`)
      }
      return {
        state: state as CollectionStatus["state"],
        merchantOrderId: optionalString(data.merchantOrderId) ?? merchantOrderId,
        providerOrderId: optionalString(data.providerOrderId),
        merchantSubscriptionId: requiredString(data.merchantSubscriptionId, "merchantSubscriptionId"),
        amountPaise: requiredString(data.amountPaise, "amountPaise"),
        expiresAt: requiredDate(data.expiresAt, "expiresAt"),
        paymentDetails: detailsOf(data.paymentDetails),
      }
    },

    cancelMandate: async (merchantSubscriptionId: string): Promise<void> => {
      await call(PATHS.cancel, { merchantSubscriptionId })
    },
  })
}
