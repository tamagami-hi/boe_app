import {
  GatewayAuthenticationError,
  GatewayCredentialError,
  GatewayMalformedResponseError,
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
} from "./paymentGateway.js"

export type GatewayFailureKind =
  | "gateway_unconfigured"
  | "provider_auth_rejected"
  | "request_rejected"
  | "provider_timeout"
  | "provider_5xx"
  | "malformed_response"
  | "provider_unavailable"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const causeStatusCode = (error: unknown): number | null => {
  if (!isRecord(error)) return null
  const cause = "cause" in error ? error.cause : error
  if (!isRecord(cause)) return null
  const code = cause.httpStatusCode
  return typeof code === "number" && Number.isInteger(code) ? code : null
}

const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"])

const isTimeoutCause = (error: unknown): boolean => {
  if (!isRecord(error)) return false
  const cause = "cause" in error ? error.cause : error
  if (!isRecord(cause)) return false
  const code = cause.code
  if (typeof code === "string" && TIMEOUT_CODES.has(code)) return true
  return cause.timeout === true || cause.name === "TimeoutError"
}

export const classifyGatewayFailure = (error: unknown): GatewayFailureKind => {
  if (error instanceof GatewayAuthenticationError || error instanceof GatewayCredentialError) return "provider_auth_rejected"
  if (error instanceof GatewayRejectedError || error instanceof GatewayNotFoundError) return "request_rejected"
  if (error instanceof GatewayMalformedResponseError) return "malformed_response"
  if (error instanceof GatewayUnavailableError) {
    const status = causeStatusCode(error)
    if (status !== null && status >= 500) return "provider_5xx"
    if (isTimeoutCause(error)) return "provider_timeout"
    return "provider_unavailable"
  }
  return "provider_unavailable"
}

export interface GatewayFailureLogFields {
  readonly requestId: string
  readonly operation: string
}

export interface GatewayFailureLogger {
  readonly warn: (fields: Record<string, unknown>, message: string) => void
}

export const logGatewayFailure = (
  logger: GatewayFailureLogger | null,
  error: unknown,
  fields: GatewayFailureLogFields,
): void => {
  if (logger === null) return
  logger.warn(
    {
      requestId: fields.requestId,
      provider: "payment_service",
      operation: fields.operation,
      failureKind: classifyGatewayFailure(error),
    },
    "payment service call failed",
  )
}

export const logGatewayUnconfigured = (
  logger: GatewayFailureLogger | null,
  fields: GatewayFailureLogFields,
): void => {
  if (logger === null) return
  logger.warn(
    {
      requestId: fields.requestId,
      provider: "payment_service",
      operation: fields.operation,
      failureKind: "gateway_unconfigured",
    },
    "the payment service is not configured",
  )
}
