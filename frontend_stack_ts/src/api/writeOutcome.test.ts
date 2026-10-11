import { describe, expect, it } from "vitest"

import { ApiError, ConfigurationMismatchError, TransportError, isUnknownWriteOutcome } from "~/api/errors"
import type { ErrorCode } from "@beonedge/contracts"

const apiError = (code: ErrorCode, status: number): ApiError =>
  new ApiError({ code, message: code, status, retryable: status >= 500 })

describe("whether a failed write may still have been applied", () => {
  it("treats every transport failure as unknown, because the server may have committed before the reply was lost", () => {
    for (const kind of ["timeout", "offline", "malformed"] as const) {
      expect(isUnknownWriteOutcome(new TransportError(kind, kind)), kind).toBe(true)
    }
  })

  it("treats a server or gateway failure as unknown", () => {
    expect(isUnknownWriteOutcome(apiError("INTERNAL_ERROR", 500))).toBe(true)
    expect(isUnknownWriteOutcome(apiError("INTERNAL_ERROR", 502))).toBe(true)
    expect(isUnknownWriteOutcome(apiError("DEPENDENCY_UNAVAILABLE", 503))).toBe(true)
    expect(isUnknownWriteOutcome(apiError("INTERNAL_ERROR", 504))).toBe(true)
  })

  it("treats an idempotency conflict as unknown, because a write already exists or is running under that key", () => {
    expect(isUnknownWriteOutcome(apiError("IDEMPOTENCY_IN_PROGRESS", 409))).toBe(true)
    expect(isUnknownWriteOutcome(apiError("IDEMPOTENCY_KEY_REUSED", 409))).toBe(true)
  })

  it("treats an error it does not recognise as unknown", () => {
    expect(isUnknownWriteOutcome(new Error("aborted"))).toBe(true)
    expect(isUnknownWriteOutcome("thrown string")).toBe(true)
  })

  it("treats a definite rejection by the server as nothing applied", () => {
    const rejections: readonly (readonly [ErrorCode, number])[] = [
      ["VALIDATION_FAILED", 400],
      ["AUTHENTICATION_REQUIRED", 401],
      ["SESSION_INVALID", 401],
      ["CSRF_INVALID", 403],
      ["AUTHORIZATION_DENIED", 403],
      ["RESOURCE_NOT_FOUND", 404],
      ["STATE_CONFLICT", 409],
      ["RATE_LIMITED", 429],
    ]
    for (const [code, status] of rejections) {
      expect(isUnknownWriteOutcome(apiError(code, status)), code).toBe(false)
    }
  })

  it("treats a request refused before it was sent as nothing applied", () => {
    expect(isUnknownWriteOutcome(new ConfigurationMismatchError("missing key"))).toBe(false)
  })
})
