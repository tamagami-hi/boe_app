import { describe, expect, test } from "vitest"
import { z } from "zod"

import { AppError } from "./errorCatalog.js"
import { parseOrThrow, zodFieldErrors } from "./validation.js"

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0),
})

describe("parseOrThrow", () => {
  test("returns parsed data on success", () => {
    expect(parseOrThrow(schema, { email: "a@example.com", age: 3 })).toEqual({
      email: "a@example.com",
      age: 3,
    })
  })

  test("throws VALIDATION_FAILED with public field paths on failure", () => {
    try {
      parseOrThrow(schema, { email: "nope", age: -1 })
      throw new Error("expected a validation error")
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError)
      const appError = error as AppError
      expect(appError.code).toBe("VALIDATION_FAILED")
      expect(Object.keys(appError.fields ?? {})).toEqual(expect.arrayContaining(["email", "age"]))
    }
  })

  test("maps a root issue to _root", () => {
    const fields = zodFieldErrors(z.string().safeParse(123).error ?? new z.ZodError([]))
    expect(Object.keys(fields)).toContain("_root")
  })
})
