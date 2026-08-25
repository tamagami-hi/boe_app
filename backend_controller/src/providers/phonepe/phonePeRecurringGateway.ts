import {
  PHONEPE_MAX_CHECKOUT_SECONDS,
  PHONEPE_MIN_CHECKOUT_SECONDS,
} from "../../domain/payments/checkoutExpiry.js"
import type {
  CreateMandateSdkOrderCommand,
  CollectionNotificationResult,
  CollectionStatus,
  MandateSdkOrderCreated,
  MandateSetupStatus,
  MandateStatus,
  NotifyCollectionCommand,
  ProviderMandateState,
  ProviderPaymentDetail,
  RecurringPaymentGateway,
} from "../recurringPaymentGateway.js"
import {
  GatewayCredentialError,
  GatewayMalformedResponseError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayThrottledError,
  GatewayUnavailableError,
} from "./paymentGateway.js"
import { createPhonePeApiClient } from "./phonePeApiClient.js"
import type { PhonePeApiConfig, PhonePeHttpClient } from "./phonePeApiClient.js"

const MAX_MANDATE_AMOUNT_PAISE = 1_500_000
const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,63}$/u
const SETUP_STATES = new Set(["PENDING", "FAILED", "COMPLETED"])
const MANDATE_STATES = new Set<ProviderMandateState>([
  "ACTIVATION_IN_PROGRESS",
  "ACTIVE",
  "EXPIRED",
  "FAILED",
  "CANCEL_IN_PROGRESS",
  "CANCELLED",
  "REVOKE_IN_PROGRESS",
  "REVOKED",
  "PAUSE_IN_PROGRESS",
  "PAUSED",
  "UNPAUSE_IN_PROGRESS",
])
const COLLECTION_STATES = new Set(["NOTIFICATION_IN_PROGRESS", "NOTIFIED", "PENDING", "COMPLETED", "FAILED"])
const COLLECTION_FLOW_TYPES = new Set(["SUBSCRIPTION_CHECKOUT_REDEMPTION", "SUBSCRIPTION_REDEMPTION"])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const requiredString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null

const optionalString = (value: unknown): string | null =>
  value === undefined || value === null ? null : requiredString(value)

const json = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const bodyOf = async (response: Response): Promise<unknown> => {
  if (response.ok) return json(response)
  if (response.status === 401 || response.status === 403) {
    throw new GatewayCredentialError("the provider rejected gateway credentials")
  }
  if (response.status === 404) throw new GatewayNotFoundError("the provider order was not found")
  if (response.status === 429) throw new GatewayThrottledError("the provider throttled the request")
  if (response.status < 500) throw new GatewayRejectedError("the provider rejected the request")
  throw new GatewayUnavailableError("the provider call failed; retry later", { cause: { httpStatusCode: response.status } })
}

const amountOf = (value: string): number => {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new GatewayRejectedError("invalid mandate amount")
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > MAX_MANDATE_AMOUNT_PAISE) {
    throw new GatewayRejectedError("invalid mandate amount")
  }
  return amount
}

const expiryOf = (value: number): number => {
  if (!Number.isInteger(value) || value < PHONEPE_MIN_CHECKOUT_SECONDS || value > PHONEPE_MAX_CHECKOUT_SECONDS) {
    throw new GatewayRejectedError("invalid checkout expiry")
  }
  return value
}

const referenceOf = (value: string): string => {
  if (!REFERENCE_PATTERN.test(value)) throw new GatewayRejectedError("invalid provider reference")
  return value
}

const epochDateOf = (value: unknown): Date => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new GatewayMalformedResponseError("the provider returned an invalid expiry")
  }
  const result = new Date(value)
  if (Number.isNaN(result.getTime())) throw new GatewayMalformedResponseError("the provider returned an invalid expiry")
  return result
}

const paymentDetailsOf = (value: unknown): readonly ProviderPaymentDetail[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new GatewayMalformedResponseError("the provider returned invalid payment details")
  return value.map((entry) => {
    if (!isRecord(entry)) throw new GatewayMalformedResponseError("the provider returned invalid payment details")
    const transactionId = requiredString(entry.transactionId)
    const state = requiredString(entry.state)
    const amount = entry.amount
    if (transactionId === null || state === null) {
      throw new GatewayMalformedResponseError("the provider returned invalid payment details")
    }
    return {
      transactionId,
      state,
      amountPaise: typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 ? String(amount) : null,
      instrumentType: optionalString(entry.paymentMode),
    }
  })
}

export const createPhonePeRecurringGateway = (
  deps: Readonly<{ config: PhonePeApiConfig; httpClient?: PhonePeHttpClient; clock?: () => Date }>,
): RecurringPaymentGateway => {
  const api = createPhonePeApiClient(deps)

  const createMandateSdkOrder = async (
    command: CreateMandateSdkOrderCommand,
  ): Promise<MandateSdkOrderCreated> => {
    const response = await api.authorizedRequest("/checkout/v2/sdk/order", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantOrderId: referenceOf(command.merchantOrderId),
        amount: amountOf(command.amountPaise),
        expireAfter: expiryOf(command.expireAfterSeconds),
        paymentFlow: {
          type: "SUBSCRIPTION_CHECKOUT_SETUP",
          subscriptionDetails: {
            subscriptionType: "RECURRING",
            merchantSubscriptionId: referenceOf(command.merchantSubscriptionId),
            authWorkflowType: "TRANSACTION",
            amountType: "FIXED",
            maxAmount: amountOf(command.amountPaise),
            frequency: "MONTHLY",
            productType: "UPI_MANDATE",
            expireAt: command.mandateExpiresAt.getTime(),
          },
        },
      }),
    })
    const body = await bodyOf(response)
    if (!isRecord(body)) throw new GatewayMalformedResponseError("the provider returned an invalid mandate SDK order")
    const providerOrderId = requiredString(body.orderId)
    const sdkToken = requiredString(body.token)
    const expireAt = typeof body.expireAt === "number" ? body.expireAt : body.expiryAt
    if (
      providerOrderId === null || body.state !== "PENDING" || sdkToken === null ||
      typeof expireAt !== "number" || !Number.isSafeInteger(expireAt) || expireAt <= 0
    ) throw new GatewayMalformedResponseError("the provider returned an invalid mandate SDK order")
    const expiresAt = new Date(expireAt)
    if (Number.isNaN(expiresAt.getTime())) throw new GatewayMalformedResponseError("the provider returned an invalid mandate SDK order")
    return { providerOrderId, providerState: "PENDING", sdkToken, expiresAt }
  }

  const getSetupOrderStatus = async (merchantOrderId: string): Promise<MandateSetupStatus> => {
    const response = await api.authorizedRequest(
      `/checkout/v2/order/${encodeURIComponent(referenceOf(merchantOrderId))}/status?details=true`,
      { method: "GET", headers: { Accept: "application/json" } },
    )
    const body = await bodyOf(response)
    if (!isRecord(body) || !SETUP_STATES.has(String(body.state)) || !isRecord(body.paymentFlow)) {
      throw new GatewayMalformedResponseError("the provider returned an invalid mandate setup status")
    }
    if (body.paymentFlow.type !== "SUBSCRIPTION_CHECKOUT_SETUP") {
      throw new GatewayMalformedResponseError("the provider returned an invalid mandate setup flow")
    }
    const merchantSubscriptionId = requiredString(body.paymentFlow.merchantSubscriptionId)
    if (merchantSubscriptionId === null) {
      throw new GatewayMalformedResponseError("the provider returned an invalid mandate setup status")
    }
    return {
      state: body.state as MandateSetupStatus["state"],
      providerOrderId: optionalString(body.orderId),
      merchantSubscriptionId,
      providerSubscriptionId: optionalString(body.paymentFlow.subscriptionId),
      paymentDetails: paymentDetailsOf(body.paymentDetails),
    }
  }

  const getMandateStatus = async (merchantSubscriptionId: string): Promise<MandateStatus> => {
    const response = await api.authorizedRequest(
      `/checkout/v2/subscriptions/${encodeURIComponent(referenceOf(merchantSubscriptionId))}/status`,
      { method: "GET", headers: { Accept: "application/json" } },
    )
    const body = await bodyOf(response)
    if (!isRecord(body) || !MANDATE_STATES.has(body.state as ProviderMandateState)) {
      throw new GatewayMalformedResponseError("the provider returned an invalid mandate status")
    }
    const correlatedMerchantId = requiredString(body.merchantSubscriptionId)
    if (correlatedMerchantId !== merchantSubscriptionId) {
      throw new GatewayMalformedResponseError("the provider returned an invalid mandate correlation")
    }
    return {
      state: body.state as ProviderMandateState,
      merchantSubscriptionId: correlatedMerchantId,
      providerSubscriptionId: optionalString(body.subscriptionId),
    }
  }

  const notifyCollection = async (
    command: NotifyCollectionCommand,
  ): Promise<CollectionNotificationResult> => {
    const response = await api.authorizedRequest("/checkout/v2/subscriptions/notify", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantOrderId: referenceOf(command.merchantOrderId),
        amount: amountOf(command.amountPaise),
        expireAt: command.expireAt.getTime(),
        paymentFlow: {
          type: "SUBSCRIPTION_CHECKOUT_REDEMPTION",
          merchantSubscriptionId: referenceOf(command.merchantSubscriptionId),
          redemptionRetryStrategy: "STANDARD",
          autoDebit: true,
        },
      }),
    })
    const body = await bodyOf(response)
    if (!isRecord(body) || body.state !== "NOTIFICATION_IN_PROGRESS") {
      throw new GatewayMalformedResponseError("the provider returned an invalid collection notification")
    }
    const providerOrderId = requiredString(body.orderId)
    if (providerOrderId === null) throw new GatewayMalformedResponseError("the provider returned an invalid collection notification")
    return {
      providerOrderId,
      providerState: "NOTIFICATION_IN_PROGRESS",
      expiresAt: epochDateOf(body.expireAt),
    }
  }

  const getCollectionStatus = async (merchantOrderId: string): Promise<CollectionStatus> => {
    const expectedMerchantOrderId = referenceOf(merchantOrderId)
    const response = await api.authorizedRequest(
      `/checkout/v2/order/${encodeURIComponent(expectedMerchantOrderId)}/status?details=true`,
      { method: "GET", headers: { Accept: "application/json" } },
    )
    const body = await bodyOf(response)
    if (!isRecord(body) || !COLLECTION_STATES.has(String(body.state)) || !isRecord(body.paymentFlow)) {
      throw new GatewayMalformedResponseError("the provider returned an invalid collection status")
    }
    const correlatedMerchantOrderId = optionalString(body.merchantOrderId)
    if (correlatedMerchantOrderId !== null && correlatedMerchantOrderId !== expectedMerchantOrderId) {
      throw new GatewayMalformedResponseError("the provider returned an invalid collection correlation")
    }
    if (
      !COLLECTION_FLOW_TYPES.has(String(body.paymentFlow.type)) ||
      body.paymentFlow.redemptionRetryStrategy !== "STANDARD" ||
      body.paymentFlow.autoDebit !== true ||
      body.currency !== "INR"
    ) throw new GatewayMalformedResponseError("the provider returned an invalid collection flow")
    const merchantSubscriptionId = requiredString(body.paymentFlow.merchantSubscriptionId)
    const amount = body.amount
    if (merchantSubscriptionId === null || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 100) {
      throw new GatewayMalformedResponseError("the provider returned an invalid collection status")
    }
    return {
      state: body.state as CollectionStatus["state"],
      merchantOrderId: expectedMerchantOrderId,
      providerOrderId: optionalString(body.orderId),
      merchantSubscriptionId,
      amountPaise: String(amount),
      expiresAt: epochDateOf(body.expireAt),
      paymentDetails: paymentDetailsOf(body.paymentDetails),
    }
  }

  const cancelMandate = async (merchantSubscriptionId: string): Promise<void> => {
    const response = await api.authorizedRequest(
      `/checkout/v2/subscriptions/${encodeURIComponent(referenceOf(merchantSubscriptionId))}/cancel`,
      { method: "POST", headers: { Accept: "application/json" } },
    )
    if (response.status !== 204) {
      await bodyOf(response)
      throw new GatewayMalformedResponseError("the provider returned an invalid mandate cancellation response")
    }
  }

  return Object.freeze({ createMandateSdkOrder, getSetupOrderStatus, getMandateStatus, notifyCollection, getCollectionStatus, cancelMandate })
}
