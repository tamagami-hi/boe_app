import { z } from "zod"

type ErrorDefinition = Readonly<{
  httpStatus: number
  retryable: boolean
}>

const createErrorDefinition = <THttpStatus extends number, TRetryable extends boolean>(
  httpStatus: THttpStatus,
  retryable: TRetryable,
) => Object.freeze({ httpStatus, retryable })

export const ERROR_DEFINITIONS = Object.freeze({
  VALIDATION_FAILED: createErrorDefinition(400, false),
  CURSOR_INVALID: createErrorDefinition(400, false),
  TOKEN_INVALID: createErrorDefinition(400, false),
  AUTHENTICATION_REQUIRED: createErrorDefinition(401, false),
  INVALID_CREDENTIALS: createErrorDefinition(401, false),
  SESSION_INVALID: createErrorDefinition(401, false),
  SNS_SIGNATURE_INVALID: createErrorDefinition(401, false),
  AUTHORIZATION_DENIED: createErrorDefinition(403, false),
  ACCOUNT_NOT_ACTIVE: createErrorDefinition(403, false),
  CSRF_INVALID: createErrorDefinition(403, false),
  RESOURCE_NOT_FOUND: createErrorDefinition(404, false),
  ACTIVE_APPLICATION_EXISTS: createErrorDefinition(409, false),
  STATE_CONFLICT: createErrorDefinition(409, true),
  IDEMPOTENCY_KEY_REUSED: createErrorDefinition(409, false),
  IDEMPOTENCY_IN_PROGRESS: createErrorDefinition(409, true),
  TOKEN_ALREADY_USED: createErrorDefinition(409, false),
  TOKEN_EXPIRED: createErrorDefinition(410, false),
  PAYLOAD_TOO_LARGE: createErrorDefinition(413, false),
  UNSUPPORTED_MEDIA_TYPE: createErrorDefinition(415, false),
  RATE_LIMITED: createErrorDefinition(429, true),
  INTERNAL_ERROR: createErrorDefinition(500, true),
  DEPENDENCY_UNAVAILABLE: createErrorDefinition(503, true),
} as const satisfies Readonly<Record<string, ErrorDefinition>>)

type CatalogErrorCode = keyof typeof ERROR_DEFINITIONS

export const ERROR_CODES = Object.freeze(Object.keys(ERROR_DEFINITIONS) as CatalogErrorCode[])

export const ErrorCode = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof ErrorCode>
