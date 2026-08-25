import {
  PHONEPE_MAX_CHECKOUT_SECONDS,
  PHONEPE_MIN_CHECKOUT_SECONDS,
} from "../../domain/payments/checkoutExpiry.js"
import type {
  CreateSdkOrderCommand,
  MobilePaymentGateway,
  SdkOrderCreated,
} from "../mobilePaymentGateway.js"
import {
  GatewayCredentialError,
  GatewayMalformedResponseError,
  GatewayRejectedError,
  GatewayUnavailableError,
} from "./paymentGateway.js"
import { createPhonePeApiClient } from "./phonePeApiClient.js"
import type { PhonePeApiConfig, PhonePeHttpClient } from "./phonePeApiClient.js"

export type { PhonePeHttpClient } from "./phonePeApiClient.js"

export type PhonePeMobileOrderConfig = PhonePeApiConfig

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const requiredString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null

const safeJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const assertSuccessful = async (response: Response): Promise<unknown> => {
  if (response.ok) return safeJson(response)
  if (response.status === 401 || response.status === 403) {
    throw new GatewayCredentialError("the provider rejected gateway credentials")
  }
  if (response.status >= 400 && response.status < 500) {
    throw new GatewayRejectedError("the provider rejected the request")
  }
  throw new GatewayUnavailableError("the provider call failed; retry later", {
    cause: { httpStatusCode: response.status },
  })
}

const safeAmount = (amountPaise: string): number => {
  if (!/^[1-9][0-9]*$/u.test(amountPaise)) throw new GatewayRejectedError("invalid payment amount")
  const amount = Number(amountPaise)
  if (!Number.isSafeInteger(amount) || amount < 100) throw new GatewayRejectedError("invalid payment amount")
  return amount
}

const safeExpiry = (expireAfterSeconds: number): number => {
  if (
    !Number.isInteger(expireAfterSeconds) ||
    expireAfterSeconds < PHONEPE_MIN_CHECKOUT_SECONDS ||
    expireAfterSeconds > PHONEPE_MAX_CHECKOUT_SECONDS
  ) {
    throw new GatewayRejectedError("invalid checkout expiry")
  }
  return expireAfterSeconds
}

export const createPhonePeMobileOrderGateway = (
  deps: Readonly<{ config: PhonePeMobileOrderConfig; httpClient?: PhonePeHttpClient; clock?: () => Date }>,
): MobilePaymentGateway => {
  const httpClient = deps.httpClient ?? fetch
  const api = createPhonePeApiClient({
    config: deps.config,
    httpClient,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
  })

  const postOrder = async (command: CreateSdkOrderCommand): Promise<Response> =>
    api.authorizedRequest("/checkout/v2/sdk/order", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantOrderId: command.merchantOrderId,
        amount: safeAmount(command.amountPaise),
        expireAfter: safeExpiry(command.expireAfterSeconds),
        paymentFlow: {
          type: "PG_CHECKOUT",
          paymentModeConfig: { enabledPaymentModes: [{ type: "UPI_INTENT" }] },
        },
      }),
    })

  const createSdkOrder = async (command: CreateSdkOrderCommand): Promise<SdkOrderCreated> => {
    const response = await postOrder(command)
    const body = await assertSuccessful(response)
    if (!isRecord(body)) throw new GatewayMalformedResponseError("the provider returned an invalid SDK order")
    const providerOrderId = requiredString(body.orderId)
    const providerState = requiredString(body.state)
    const sdkToken = requiredString(body.token)
    const expireAt = body.expireAt
    if (
      providerOrderId === null ||
      providerState !== "PENDING" ||
      sdkToken === null ||
      typeof expireAt !== "number" ||
      !Number.isSafeInteger(expireAt) ||
      expireAt <= 0
    ) {
      throw new GatewayMalformedResponseError("the provider returned an invalid SDK order")
    }
    const expiresAt = new Date(expireAt)
    if (Number.isNaN(expiresAt.getTime())) {
      throw new GatewayMalformedResponseError("the provider returned an invalid SDK order")
    }
    return { providerOrderId, providerState, sdkToken, expiresAt }
  }

  return Object.freeze({ createSdkOrder })
}
