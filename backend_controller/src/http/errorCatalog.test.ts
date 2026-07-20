import { describe, expect, test } from "vitest"

import {
  AppError,
  appErrorFromOutcome,
  ERROR_DEFAULT_MESSAGE,
  ERROR_HTTP_STATUS,
  ERROR_RETRYABLE,
  mapInternalOutcome,
  type ErrorCode,
} from "./errorCatalog.js"

const ALL_CODES = Object.keys(ERROR_HTTP_STATUS) as ErrorCode[]

describe("error catalog", () => {
  test("every code has a status, retryable flag, and message", () => {
    for (const code of ALL_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400)
      expect(typeof ERROR_RETRYABLE[code]).toBe("boolean")
      expect(ERROR_DEFAULT_MESSAGE[code].trim()).not.toBe("")
    }
  })

  test("AppError derives status and retryable from its code", () => {
    const error = new AppError("STATE_CONFLICT")
    expect(error.httpStatus).toBe(409)
    expect(error.retryable).toBe(true)
    expect(error.message).toBe(ERROR_DEFAULT_MESSAGE.STATE_CONFLICT)
  })

  test("AppError accepts fields, a custom message, and retry-after", () => {
    const error = new AppError("VALIDATION_FAILED", {
      message: "Custom",
      fields: { email: ["is required"] },
      retryAfterSeconds: 1,
    })
    expect(error.message).toBe("Custom")
    expect(error.fields).toEqual({ email: ["is required"] })
    expect(error.retryAfterSeconds).toBe(1)
  })

  test("maps internal outcomes to public codes and defaults to INTERNAL_ERROR", () => {
    expect(mapInternalOutcome("BAD_CREDENTIALS")).toBe("INVALID_CREDENTIALS")
    expect(mapInternalOutcome("VERSION_CONFLICT")).toBe("STATE_CONFLICT")
    expect(mapInternalOutcome("DATABASE_UNAVAILABLE")).toBe("DEPENDENCY_UNAVAILABLE")
    expect(mapInternalOutcome("something_unknown")).toBe("INTERNAL_ERROR")
    expect(appErrorFromOutcome("NOT_FOUND").code).toBe("RESOURCE_NOT_FOUND")
  })
})
