import type { z } from "zod"
import { describe, expect, expectTypeOf, it } from "vitest"

import * as Contracts from "./index.js"
import { ERROR_CODES, ERROR_DEFINITIONS, ErrorCode } from "./errors.js"

const EXPECTED_ERROR_DEFINITIONS = {
  VALIDATION_FAILED: { httpStatus: 400, retryable: false },
  CURSOR_INVALID: { httpStatus: 400, retryable: false },
  TOKEN_INVALID: { httpStatus: 400, retryable: false },
  AUTHENTICATION_REQUIRED: { httpStatus: 401, retryable: false },
  INVALID_CREDENTIALS: { httpStatus: 401, retryable: false },
  SESSION_INVALID: { httpStatus: 401, retryable: false },
  SNS_SIGNATURE_INVALID: { httpStatus: 401, retryable: false },
  AUTHORIZATION_DENIED: { httpStatus: 403, retryable: false },
  ACCOUNT_NOT_ACTIVE: { httpStatus: 403, retryable: false },
  CSRF_INVALID: { httpStatus: 403, retryable: false },
  RESOURCE_NOT_FOUND: { httpStatus: 404, retryable: false },
  ACTIVE_APPLICATION_EXISTS: { httpStatus: 409, retryable: false },
  STATE_CONFLICT: { httpStatus: 409, retryable: true },
  IDEMPOTENCY_KEY_REUSED: { httpStatus: 409, retryable: false },
  IDEMPOTENCY_IN_PROGRESS: { httpStatus: 409, retryable: true },
  TOKEN_ALREADY_USED: { httpStatus: 409, retryable: false },
  TOKEN_EXPIRED: { httpStatus: 410, retryable: false },
  PAYLOAD_TOO_LARGE: { httpStatus: 413, retryable: false },
  UNSUPPORTED_MEDIA_TYPE: { httpStatus: 415, retryable: false },
  RATE_LIMITED: { httpStatus: 429, retryable: true },
  INTERNAL_ERROR: { httpStatus: 500, retryable: true },
  DEPENDENCY_UNAVAILABLE: { httpStatus: 503, retryable: true },
} as const
type ExpectedErrorCode = keyof typeof EXPECTED_ERROR_DEFINITIONS

describe("public error catalog", () => {
  it("exports the catalog and schema from the package root", () => {
    expect(Contracts.ErrorCode).toBe(ErrorCode)
    expect(Contracts.ERROR_CODES).toBe(ERROR_CODES)
    expect(Contracts.ERROR_DEFINITIONS).toBe(ERROR_DEFINITIONS)
  })

  it("contains every canonical code exactly once with its HTTP policy", () => {
    expect(ERROR_DEFINITIONS).toEqual(EXPECTED_ERROR_DEFINITIONS)
    expect(ERROR_CODES).toEqual(Object.keys(EXPECTED_ERROR_DEFINITIONS))
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })

  it("keeps the exported catalog deeply immutable at runtime", () => {
    expect(Object.isFrozen(ERROR_DEFINITIONS)).toBe(true)
    expect(Object.isFrozen(ERROR_CODES)).toBe(true)

    for (const definition of Object.values(ERROR_DEFINITIONS)) {
      expect(Object.isFrozen(definition)).toBe(true)
    }

    const mutableDefinitions = ERROR_DEFINITIONS as unknown as Record<
      string,
      { httpStatus: number; retryable: boolean }
    >
    expect(() => {
      mutableDefinitions.STATE_CONFLICT!.retryable = false
    }).toThrow(TypeError)
    expect(ERROR_DEFINITIONS.STATE_CONFLICT.retryable).toBe(true)
  })

  it("accepts all canonical codes", () => {
    for (const code of ERROR_CODES) {
      expect(ErrorCode.parse(code)).toBe(code)
    }
  })

  it("infers the public wire type from the ErrorCode schema", () => {
    expectTypeOf<z.infer<typeof ErrorCode>>().toEqualTypeOf<ExpectedErrorCode>()
  })

  it("rejects internal outcomes, unknown values, wrong case, and non-strings", () => {
    for (const value of ["BAD_CREDENTIALS", "UNKNOWN_ERROR", "validation_failed", 400, null]) {
      expect(ErrorCode.safeParse(value).success, String(value)).toBe(false)
    }
  })
})
