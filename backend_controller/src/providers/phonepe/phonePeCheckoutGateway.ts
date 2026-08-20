/**
 * PhonePe Standard Checkout adapter for the PaymentGateway port (spec §7).
 *
 * This module is the only place PhonePe SDK types, builders, and exceptions are
 * referenced. Everything crossing the boundary is mapped into the port's own
 * types in `./paymentGateway.ts`:
 *
 *   - money crosses as decimal paise strings, converted to the SDK's `number`
 *     only after proving the value is a safe positive integer (an amount above
 *     2^53 would silently lose paise, which is why the port speaks strings);
 *   - provider states map onto succeeded/failed/pending — `COMPLETED` succeeds,
 *     `FAILED` fails, and anything else (including states PhonePe adds later)
 *     stays non-terminal;
 *   - callback payloads are deserialized tolerantly: the fields the domain
 *     needs are validated, unknown fields are ignored, and the raw body's
 *     top-level `event` (never the legacy `type`) names the event.
 *
 * Nothing here logs: credentials, authorization headers, instruments, and raw
 * payloads must never reach a log line (spec §7/§10).
 */
import { Env, StandardCheckoutClient, StandardCheckoutPayRequest, RefundRequest } from "@phonepe-pg/pg-sdk-node"

import {
  GatewayAuthenticationError,
  type GatewayError,
  GatewayMalformedCallbackError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
  type CheckoutCreated,
  type CreateCheckoutCommand,
  type InitiateRefundCommand,
  type OrderStatusFact,
  type PaymentGateway,
  type ProviderOutcome,
  type ProviderPaymentDetailFact,
  type RefundInitiated,
  type RefundStatusFact,
  type VerifiedCallback,
} from "./paymentGateway.js"

export interface PhonePeGatewayConfig {
  readonly clientId: string
  readonly clientSecret: string
  readonly clientVersion: string
  readonly env: "sandbox" | "production"
  readonly callbackUsername: string
  readonly callbackPassword: string
  readonly redirectUrl: string | null
}

/**
 * The slice of `StandardCheckoutClient` the adapter consumes, typed
 * structurally over `unknown` so tests substitute a stub and the adapter's own
 * mapping is the only deserialization that matters.
 */
export interface PhonePeSdkClient {
  readonly pay: (request: unknown) => Promise<unknown>
  readonly getOrderStatus: (merchantOrderId: string, details?: boolean) => Promise<unknown>
  readonly validateCallback: (
    username: string,
    password: string,
    authorization: string,
    responseBody: string,
  ) => unknown
  readonly refund: (request: unknown) => Promise<unknown>
  readonly getRefundStatus: (refundId: string) => Promise<unknown>
}

export interface PhonePeCheckoutGatewayDeps {
  readonly config: PhonePeGatewayConfig
  /** Injected in tests; the real SDK client is built from the config otherwise. */
  readonly client?: PhonePeSdkClient
}

/** Decimal-string paise -> SDK number, or a rejection when precision would be lost. */
const paiseToNumber = (amountPaise: string): number => {
  if (!/^[1-9][0-9]*$/u.test(amountPaise)) {
    throw new GatewayRejectedError(`amount '${amountPaise}' is not a positive integer paise string`)
  }
  const value = BigInt(amountPaise)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new GatewayRejectedError("amount exceeds the exactly representable range")
  }
  return Number(value)
}

/** SDK number -> decimal paise string; anything non-integral is unusable evidence. */
const paiseFromNumber = (amount: unknown): string | null => {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return null
  return String(amount)
}

/** `COMPLETED` succeeds, `FAILED` fails, every other state is non-terminal (spec §7). */
const mapOutcome = (providerState: string): ProviderOutcome => {
  if (providerState === "COMPLETED") return "succeeded"
  if (providerState === "FAILED") return "failed"
  return "pending"
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null

const mapPaymentDetails = (value: unknown): readonly ProviderPaymentDetailFact[] => {
  if (!Array.isArray(value)) return []
  const facts: ProviderPaymentDetailFact[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    // A detail without a provider transaction id cannot be keyed (spec §5.2);
    // it is evidence-shaped noise, so it is skipped rather than stored.
    const transactionId = optionalString(entry.transactionId)
    if (transactionId === null) continue
    facts.push({
      transactionId,
      reference: null,
      instrumentType: optionalString(entry.paymentMode),
      state: optionalString(entry.state),
      amountPaise: paiseFromNumber(entry.amount),
    })
  }
  return facts
}

/** The SDK's exception family carries `httpStatusCode` on a PhonePeException. */
const sdkStatusCode = (error: unknown): number | null => {
  if (!isRecord(error)) return null
  const code = error.httpStatusCode
  return typeof code === "number" && Number.isInteger(code) ? code : null
}

const mapCallError = (error: unknown): GatewayError => {
  const status = sdkStatusCode(error)
  if (status === 404) return new GatewayNotFoundError("the provider does not know this reference", { cause: error })
  if (status === 400) return new GatewayRejectedError("the provider rejected the request", { cause: error })
  if (status !== null && status < 500) return new GatewayRejectedError("the provider rejected the request", { cause: error })
  return new GatewayUnavailableError("the provider call failed; retry later", { cause: error })
}

const buildClient = (config: PhonePeGatewayConfig): PhonePeSdkClient => {
  const clientVersion = Number(config.clientVersion)
  if (!Number.isInteger(clientVersion) || clientVersion <= 0) {
    throw new Error("PHONEPE_CLIENT_VERSION must be a positive integer")
  }
  // The SDK's concrete client methods take specific request/response classes,
  // not `unknown`; `PhonePeSdkClient` is deliberately narrowed to `unknown` so
  // tests can substitute a plain stub. The adapter's own mapping functions are
  // the only place that deserializes these values, so this cast is safe.
  return StandardCheckoutClient.getInstance(
    config.clientId,
    config.clientSecret,
    clientVersion,
    config.env === "sandbox" ? Env.SANDBOX : Env.PRODUCTION,
    // The SDK's event publisher phones home operational telemetry; the payment
    // flow does not depend on it, so it stays off.
    false,
  ) as unknown as PhonePeSdkClient
}

export const createPhonePeCheckoutGateway = (deps: PhonePeCheckoutGatewayDeps): PaymentGateway => {
  const client: PhonePeSdkClient = deps.client ?? buildClient(deps.config)
  const { config } = deps

  return Object.freeze({
    createCheckout: async (command: CreateCheckoutCommand): Promise<CheckoutCreated> => {
      const amount = paiseToNumber(command.amountPaise)
      const builder = StandardCheckoutPayRequest.builder()
        .merchantOrderId(command.merchantOrderId)
        .amount(amount)
        .expireAfter(command.expireAfterSeconds)
      const redirectUrl = command.redirectUrl ?? config.redirectUrl
      if (redirectUrl !== null) builder.redirectUrl(redirectUrl)

      let response: unknown
      try {
        response = await client.pay(builder.build())
      } catch (error) {
        throw mapCallError(error)
      }
      const body = isRecord(response) ? response : {}
      const checkoutUrl = optionalString(body.redirectUrl)
      if (checkoutUrl === null) {
        // A checkout without a redirect URL is unusable; treat as unavailable so
        // the caller's retry recovers rather than persisting a dead attempt.
        throw new GatewayUnavailableError("the provider returned no checkout redirect")
      }
      return {
        redirectUrl: checkoutUrl,
        providerOrderId: optionalString(body.orderId),
        expiresAt:
          typeof body.expireAt === "number" && Number.isFinite(body.expireAt) && body.expireAt > 0
            ? new Date(body.expireAt)
            : null,
      }
    },

    getOrderStatus: async (merchantOrderId: string): Promise<OrderStatusFact> => {
      let response: unknown
      try {
        // `details: true` — every attempt detail, not just the latest.
        response = await client.getOrderStatus(merchantOrderId, true)
      } catch (error) {
        throw mapCallError(error)
      }
      const body = isRecord(response) ? response : {}
      const providerState = optionalString(body.state)
      if (providerState === null) {
        throw new GatewayUnavailableError("the provider status response carried no state")
      }
      return {
        outcome: mapOutcome(providerState),
        providerState,
        providerOrderId: optionalString(body.orderId),
        amountPaise: paiseFromNumber(body.amount),
        details: mapPaymentDetails(body.paymentDetails),
      }
    },

    validateShaCallback: (authorizationHeader: string, rawBody: string): VerifiedCallback => {
      // Authorization first: the SDK checks sha256(username:password) against the
      // header and throws before parsing when it does not match.
      try {
        client.validateCallback(
          config.callbackUsername,
          config.callbackPassword,
          authorizationHeader,
          rawBody,
        )
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new GatewayMalformedCallbackError("callback body is not JSON", { cause: error })
        }
        throw new GatewayAuthenticationError("callback authorization failed", { cause: error })
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch (error) {
        throw new GatewayMalformedCallbackError("callback body is not JSON", { cause: error })
      }
      if (!isRecord(parsed)) throw new GatewayMalformedCallbackError("callback body is not an object")

      // The contract is the top-level `event` plus nested `payload.state`; the
      // legacy `type` field is deliberately not read (spec §7).
      const event = optionalString(parsed.event)
      const payload = isRecord(parsed.payload) ? parsed.payload : null
      const providerState = payload === null ? null : optionalString(payload.state)
      if (event === null || payload === null || providerState === null) {
        throw new GatewayMalformedCallbackError("callback is missing event or payload.state")
      }

      return {
        event,
        outcome: mapOutcome(providerState),
        providerState,
        merchantOrderId: optionalString(payload.merchantOrderId),
        merchantRefundId: optionalString(payload.merchantRefundId),
        originalMerchantOrderId: optionalString(payload.originalMerchantOrderId),
        providerOrderId: optionalString(payload.orderId),
        providerRefundId: optionalString(payload.refundId),
        amountPaise: paiseFromNumber(payload.amount),
        details: mapPaymentDetails(payload.paymentDetails),
      }
    },

    initiateRefund: async (command: InitiateRefundCommand): Promise<RefundInitiated> => {
      const request = RefundRequest.builder()
        .merchantRefundId(command.merchantRefundId)
        .originalMerchantOrderId(command.originalMerchantOrderId)
        .amount(paiseToNumber(command.amountPaise))
        .build()
      let response: unknown
      try {
        response = await client.refund(request)
      } catch (error) {
        throw mapCallError(error)
      }
      const body = isRecord(response) ? response : {}
      const providerState = optionalString(body.state) ?? "PENDING"
      return {
        providerRefundId: optionalString(body.refundId),
        outcome: mapOutcome(providerState),
        providerState,
      }
    },

    getRefundStatus: async (merchantRefundId: string): Promise<RefundStatusFact> => {
      let response: unknown
      try {
        response = await client.getRefundStatus(merchantRefundId)
      } catch (error) {
        throw mapCallError(error)
      }
      const body = isRecord(response) ? response : {}
      const providerState = optionalString(body.state)
      if (providerState === null) {
        throw new GatewayUnavailableError("the provider refund status carried no state")
      }
      return {
        merchantRefundId: optionalString(body.merchantRefundId) ?? merchantRefundId,
        originalMerchantOrderId: optionalString(body.originalMerchantOrderId),
        amountPaise: paiseFromNumber(body.amount),
        outcome: mapOutcome(providerState),
        providerState,
      }
    },
  })
}
