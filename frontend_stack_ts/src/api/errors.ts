import { ERROR_DEFINITIONS } from "@beonedge/contracts"
import type { ErrorCode } from "@beonedge/contracts"

export type FieldErrors = Readonly<Record<string, readonly string[]>>

export type ApiErrorInit = Readonly<{
  code: ErrorCode
  message: string
  status: number
  retryable: boolean
  fields?: FieldErrors
  retryAfterSeconds?: number
  requestId?: string
}>

export class ApiError extends Error {
  public readonly code: ErrorCode
  public readonly status: number
  public readonly retryable: boolean
  public readonly fields: FieldErrors | null
  public readonly retryAfterSeconds: number | null
  public readonly requestId: string | null

  public constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = "ApiError"
    this.code = init.code
    this.status = init.status
    this.retryable = init.retryable
    this.fields = init.fields ?? null
    this.retryAfterSeconds = init.retryAfterSeconds ?? null
    this.requestId = init.requestId ?? null
  }
}

export type TransportErrorKind = "timeout" | "offline" | "malformed"

export class TransportError extends Error {
  public readonly kind: TransportErrorKind
  public readonly requestId: string | null

  public constructor(kind: TransportErrorKind, message: string, requestId?: string) {
    super(message)
    this.name = "TransportError"
    this.kind = kind
    this.requestId = requestId ?? null
  }
}

export class ConfigurationMismatchError extends Error {
  public readonly code = "CONFIGURATION_MISMATCH"

  public constructor(message: string) {
    super(message)
    this.name = "ConfigurationMismatchError"
  }
}

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError

export const isTransportError = (value: unknown): value is TransportError =>
  value instanceof TransportError

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === "string" && Object.hasOwn(ERROR_DEFINITIONS, value)

export const hasCode = (value: unknown, ...codes: readonly ErrorCode[]): boolean =>
  isApiError(value) && codes.includes(value.code)

export const isRetryable = (value: unknown): boolean => {
  if (isTransportError(value)) return value.kind !== "malformed"
  if (isApiError(value)) return value.retryable
  return false
}

export const isSessionEnded = (value: unknown): boolean =>
  hasCode(value, "AUTHENTICATION_REQUIRED", "SESSION_INVALID")

export const isOutage = (value: unknown): boolean => {
  if (isTransportError(value)) return value.kind === "timeout" || value.kind === "offline"
  return isApiError(value) && value.status >= 500
}

export const definitionFor = (code: ErrorCode): (typeof ERROR_DEFINITIONS)[ErrorCode] =>
  ERROR_DEFINITIONS[code]
