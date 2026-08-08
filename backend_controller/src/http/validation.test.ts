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

/*
 * These messages are rendered directly to visitors by the marketing site's signup
 * form, so the assertions are about what a person reads, not about Zod. The
 * strings quoted in the "leaks" test are the exact ones that reached end users
 * before the mapper existed.
 */
describe("zodFieldErrors user-facing messages", () => {
  const of = (schema: z.ZodType, input: unknown): Record<string, string[]> => {
    const result = schema.safeParse(input)
    if (result.success) throw new Error("expected a validation failure")
    return zodFieldErrors(result.error)
  }

  test("a missing field reads as required rather than as a parser error", () => {
    const fields = of(z.object({ password: z.string() }), {})
    expect(fields.password).toEqual(["This field is required."])
  })

  test("no Zod internals leak for any issue kind the signup form can produce", () => {
    const schema = z
      .object({
        email: z.string().email(),
        phone: z.string().min(8),
        name: z.string().max(4),
        acceptedConsents: z.literal(true),
        password: z.string(),
      })
      .strict()
    const fields = of(schema, {
      email: "nope",
      phone: "1",
      name: "far too long",
      acceptedConsents: false,
      confirmPassword: "x",
    })

    const everyMessage = Object.values(fields).flat().join(" | ")
    expect(everyMessage).not.toMatch(/expected|received|Unrecognized key|Too small|Too big|Invalid input/iu)
  })

  test("each issue kind gets wording a visitor can act on", () => {
    const schema = z
      .object({
        email: z.string().email(),
        phone: z.string().min(8),
        name: z.string().max(4),
        acceptedConsents: z.literal(true),
        age: z.number().max(120),
      })
      .strict()
    const fields = of(schema, {
      email: "nope",
      phone: "1",
      name: "far too long",
      acceptedConsents: false,
      age: 900,
      confirmPassword: "x",
    })

    expect(fields.email).toEqual(["Enter a valid email address."])
    expect(fields.phone).toEqual(["Must be at least 8 characters."])
    expect(fields.name).toEqual(["Must be at most 4 characters."])
    expect(fields.acceptedConsents).toEqual(["This must be accepted to continue."])
    expect(fields.age).toEqual(["Must be 120 or less."])
    // A strict-object violation is not attributable to any one input, so it must
    // not be rendered against one.
    expect(fields._root).toEqual(["The request contained fields that are not accepted."])
  })

  test("hand-written refine messages pass through untouched", () => {
    // Real schemas in this codebase phrase these for the person filling the form;
    // rewriting them here would be a downgrade.
    const schema = z.object({
      phone: z.string().refine(() => false, "must be a valid E.164 phone number"),
    })
    expect(of(schema, { phone: "0000" }).phone).toEqual(["must be a valid E.164 phone number"])
  })

  test("two issues that collapse onto the same sentence are not repeated", () => {
    const schema = z.object({ value: z.array(z.string()).min(2).max(1) })
    const messages = of(schema, { value: [] }).value ?? []
    expect(new Set(messages).size).toBe(messages.length)
  })
})
