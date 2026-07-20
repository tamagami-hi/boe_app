/**
 * Zod-backed request/response validation. A failed parse becomes an
 * `AppError("VALIDATION_FAILED")` whose `fields` uses public dot-path keys and
 * carries no internal detail (spec 04 §2.2/§2.4).
 */
import type { z } from "zod"

import { AppError } from "./errorCatalog.js"

/** Convert a ZodError into public `field -> messages` using dotted paths. */
export const zodFieldErrors = (
  error: z.ZodError,
): Record<string, string[]> => {
  const fields: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "_root" : issue.path.map((part) => String(part)).join(".")
    ;(fields[path] ??= []).push(issue.message)
  }
  return fields
}

/**
 * Parse `input` with `schema`, throwing a validation `AppError` on failure.
 * Used for request bodies, query, params, and headers at the route boundary.
 */
export const parseOrThrow = <TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> => {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", { fields: zodFieldErrors(result.error) })
  }
  return result.data
}
