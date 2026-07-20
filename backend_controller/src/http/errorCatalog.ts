/**
 * Canonical HTTP error catalog and application error type (spec 04 §2.4).
 *
 * `ErrorCode` is the exact public enum. Every code maps to a fixed HTTP status
 * and retryable flag. Internal domain/repository outcomes map explicitly to a
 * public code; handlers never serialize their internal names, PostgreSQL text,
 * stacks, provider responses, or account-existence signals.
 *
 * Named `errorCatalog` (not `errors`) so it does not collide with the legacy
 * `src/http/errors.js` at module resolution time; the legacy file is deleted in
 * BE-019.
 */
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "CURSOR_INVALID"
  | "TOKEN_INVALID"
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "SESSION_INVALID"
  | "SNS_SIGNATURE_INVALID"
  | "AUTHORIZATION_DENIED"
  | "ACCOUNT_NOT_ACTIVE"
  | "CSRF_INVALID"
  | "RESOURCE_NOT_FOUND"
  | "ACTIVE_APPLICATION_EXISTS"
  | "STATE_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "TOKEN_ALREADY_USED"
  | "TOKEN_EXPIRED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "DEPENDENCY_UNAVAILABLE"

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  CURSOR_INVALID: 400,
  TOKEN_INVALID: 400,
  AUTHENTICATION_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_INVALID: 401,
  SNS_SIGNATURE_INVALID: 401,
  AUTHORIZATION_DENIED: 403,
  ACCOUNT_NOT_ACTIVE: 403,
  CSRF_INVALID: 403,
  RESOURCE_NOT_FOUND: 404,
  ACTIVE_APPLICATION_EXISTS: 409,
  STATE_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  TOKEN_ALREADY_USED: 409,
  TOKEN_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  DEPENDENCY_UNAVAILABLE: 503,
}

export const ERROR_RETRYABLE: Readonly<Record<ErrorCode, boolean>> = {
  VALIDATION_FAILED: false,
  CURSOR_INVALID: false,
  TOKEN_INVALID: false,
  AUTHENTICATION_REQUIRED: false,
  INVALID_CREDENTIALS: false,
  SESSION_INVALID: false,
  SNS_SIGNATURE_INVALID: false,
  AUTHORIZATION_DENIED: false,
  ACCOUNT_NOT_ACTIVE: false,
  CSRF_INVALID: false,
  RESOURCE_NOT_FOUND: false,
  ACTIVE_APPLICATION_EXISTS: false,
  STATE_CONFLICT: true,
  IDEMPOTENCY_KEY_REUSED: false,
  IDEMPOTENCY_IN_PROGRESS: true,
  TOKEN_ALREADY_USED: false,
  TOKEN_EXPIRED: false,
  PAYLOAD_TOO_LARGE: false,
  UNSUPPORTED_MEDIA_TYPE: false,
  RATE_LIMITED: true,
  INTERNAL_ERROR: true,
  DEPENDENCY_UNAVAILABLE: true,
}

/** User-safe default messages. Never include SQL, stacks, or internal identifiers. */
export const ERROR_DEFAULT_MESSAGE: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "Request validation failed",
  CURSOR_INVALID: "The cursor is invalid or has expired",
  TOKEN_INVALID: "The token is invalid",
  AUTHENTICATION_REQUIRED: "Authentication is required",
  INVALID_CREDENTIALS: "The credentials are invalid",
  SESSION_INVALID: "The session is no longer valid",
  SNS_SIGNATURE_INVALID: "The notification could not be verified",
  AUTHORIZATION_DENIED: "You do not have permission to perform this action",
  ACCOUNT_NOT_ACTIVE: "The account is not active",
  CSRF_INVALID: "The request failed a cross-site protection check",
  RESOURCE_NOT_FOUND: "The requested resource was not found",
  ACTIVE_APPLICATION_EXISTS: "An active application or account already exists",
  STATE_CONFLICT: "The resource changed; retry with the current version",
  IDEMPOTENCY_KEY_REUSED: "The idempotency key was reused with a different request",
  IDEMPOTENCY_IN_PROGRESS: "An equivalent request is still being processed",
  TOKEN_ALREADY_USED: "The token has already been used",
  TOKEN_EXPIRED: "The token has expired",
  PAYLOAD_TOO_LARGE: "The request body is too large",
  UNSUPPORTED_MEDIA_TYPE: "The request media type is not supported",
  RATE_LIMITED: "Too many requests; slow down and retry",
  INTERNAL_ERROR: "An unexpected error occurred",
  DEPENDENCY_UNAVAILABLE: "A required dependency is unavailable",
}

/** Internal domain/repository outcome names mapped to the public code (spec 04 §2.4). */
export const INTERNAL_OUTCOME_TO_CODE: Readonly<Record<string, ErrorCode>> = {
  VALIDATION_ERROR: "VALIDATION_FAILED",
  UNAUTHENTICATED: "AUTHENTICATION_REQUIRED",
  BAD_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_REVOKED: "SESSION_INVALID",
  REFRESH_REUSE: "SESSION_INVALID",
  SESSION_EXPIRED: "SESSION_INVALID",
  FORBIDDEN: "AUTHORIZATION_DENIED",
  CSRF_MISMATCH: "CSRF_INVALID",
  ORIGIN_DENIED: "CSRF_INVALID",
  FETCH_SITE_DENIED: "CSRF_INVALID",
  NOT_FOUND: "RESOURCE_NOT_FOUND",
  WRONG_OWNER: "RESOURCE_NOT_FOUND",
  INVALID_STATE_TRANSITION: "STATE_CONFLICT",
  VERSION_CONFLICT: "STATE_CONFLICT",
  RESOURCE_BUSY: "STATE_CONFLICT",
  PRECONDITION_FAILED: "STATE_CONFLICT",
  IDEMPOTENCY_HASH_MISMATCH: "IDEMPOTENCY_KEY_REUSED",
  IDEMPOTENCY_LOCK_BUSY: "IDEMPOTENCY_IN_PROGRESS",
  SNS_PROVENANCE_FAILED: "SNS_SIGNATURE_INVALID",
  RATE_LIMIT_EXCEEDED: "RATE_LIMITED",
  DATABASE_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  KEY_CONFIGURATION_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  PROVIDER_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
}

/** Map an internal outcome name to a public code, defaulting to INTERNAL_ERROR. */
export const mapInternalOutcome = (internalOutcome: string): ErrorCode =>
  INTERNAL_OUTCOME_TO_CODE[internalOutcome] ?? "INTERNAL_ERROR"

export interface AppErrorOptions {
  readonly message?: string
  readonly fields?: Readonly<Record<string, readonly string[]>>
  readonly retryAfterSeconds?: number
  readonly cause?: unknown
}

/** An error carrying a public code; the boundary renders it as an ErrorEnvelope. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly httpStatus: number
  readonly retryable: boolean
  readonly fields?: Readonly<Record<string, readonly string[]>>
  readonly retryAfterSeconds?: number

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? ERROR_DEFAULT_MESSAGE[code], { cause: options.cause })
    this.name = "AppError"
    this.code = code
    this.httpStatus = ERROR_HTTP_STATUS[code]
    this.retryable = ERROR_RETRYABLE[code]
    if (options.fields !== undefined) this.fields = options.fields
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds
  }
}

/** Build an AppError from an internal outcome name. */
export const appErrorFromOutcome = (internalOutcome: string, options?: AppErrorOptions): AppError =>
  new AppError(mapInternalOutcome(internalOutcome), options)
