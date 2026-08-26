/**
 * PaymentGateway domain port (spec §7). The narrow contract the rest of the
 * backend depends on; the PhonePe SDK adapter in this directory is the only
 * implementation. PhonePe SDK DTOs never leave `providers/phonepe/` — every
 * type here is ours, and money crosses the boundary as decimal paise strings
 * (never as an unconstrained JS number).
 *
 * Terminality mapping is fixed by the spec: the provider's `COMPLETED` is a
 * success, `FAILED` is a failure, `PENDING` (and anything unrecognised) is
 * non-terminal. An unknown state must never be promoted to success.
 */
export type ProviderOutcome = "succeeded" | "failed" | "pending"

/** Base class for every gateway failure so callers can catch one type. */
export class GatewayError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
  }
}

/**
 * The callback's SHA authorization did not verify. Zero writes may follow from
 * this failure: the bytes are not from the provider.
 */
export class GatewayAuthenticationError extends GatewayError {}

export class GatewayCredentialError extends GatewayError {}

/**
 * The callback authorized but its body is not a parseable, minimally complete
 * provider event (missing `event`, missing `payload`, unusable state).
 */
export class GatewayMalformedCallbackError extends GatewayError {}

/** Network, timeout, or provider 5xx: retryable later. */
export class GatewayUnavailableError extends GatewayError {}

export class GatewayThrottledError extends GatewayUnavailableError {}

export class GatewayMalformedResponseError extends GatewayUnavailableError {}

export class GatewayNotFoundError extends GatewayError {}

/**
 * The provider rejected the request with a non-retryable client error (400).
 * The request itself is wrong; retrying it unchanged will not help.
 */
export class GatewayRejectedError extends GatewayError {}

/** One normalized entry of the provider's `paymentDetails[]` (spec §5.2). */
export interface ProviderPaymentDetailFact {
  readonly transactionId: string
  readonly reference: string | null
  readonly instrumentType: string | null
  readonly state: string | null
  readonly amountPaise: string | null
}

export interface OrderStatusFact {
  readonly merchantOrderId: string | null
  readonly outcome: ProviderOutcome
  /** The provider's own state string (e.g. `COMPLETED`), kept for evidence. */
  readonly providerState: string
  readonly providerOrderId: string | null
  readonly amountPaise: string | null
  readonly currency: string | null
  readonly details: readonly ProviderPaymentDetailFact[]
}

/**
 * A callback whose SHA authorization verified against the exact raw bytes.
 * Correlation identifiers are nullable at this layer: the ingress route for a
 * given channel asserts the one it needs is present before persisting.
 */
export interface VerifiedCallback {
  /** Top-level `event` value from the raw body (never the legacy `type`). */
  readonly event: string
  readonly outcome: ProviderOutcome
  readonly providerState: string
  readonly merchantOrderId: string | null
  readonly merchantRefundId: string | null
  readonly originalMerchantOrderId: string | null
  readonly providerOrderId: string | null
  readonly providerRefundId: string | null
  readonly amountPaise: string | null
  readonly details: readonly ProviderPaymentDetailFact[]
}

export interface InitiateRefundCommand {
  /** Stable merchant refund id, persisted before this call (spec §5.3). */
  readonly merchantRefundId: string
  /** The merchant order id of the succeeded payment being refunded. */
  readonly originalMerchantOrderId: string
  readonly amountPaise: string
}

export interface RefundInitiated {
  readonly providerRefundId: string | null
  readonly outcome: ProviderOutcome
  readonly providerState: string
}

export interface RefundStatusFact {
  readonly merchantRefundId: string
  readonly providerRefundId: string | null
  readonly originalMerchantOrderId: string | null
  readonly amountPaise: string | null
  readonly outcome: ProviderOutcome
  readonly providerState: string
}

export interface PaymentGateway {
  getOrderStatus: (merchantOrderId: string) => Promise<OrderStatusFact>
  /**
   * Verify the SHA callback authorization against the exact raw body and map
   * the payload. Throws {@link GatewayAuthenticationError} on an authorization
   * mismatch and {@link GatewayMalformedCallbackError} on an unusable body.
   */
  validateShaCallback: (authorizationHeader: string, rawBody: string) => VerifiedCallback
  initiateRefund: (command: InitiateRefundCommand) => Promise<RefundInitiated>
  getRefundStatus: (merchantRefundId: string) => Promise<RefundStatusFact>
}
