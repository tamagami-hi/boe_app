/**
 * Zod-backed request/response validation. A failed parse becomes an
 * `AppError("VALIDATION_FAILED")` whose `fields` uses public dot-path keys and
 * carries no internal detail (spec 04 §2.2/§2.4).
 *
 * ── WHY THE MESSAGES ARE REWRITTEN ──────────────────────────────────────────
 * `error.fields` is rendered directly to end users by the marketing site's
 * signup form, so Zod's own strings leaked out to visitors:
 *
 *     password: "Invalid input: expected string, received undefined"
 *     _root:    "Unrecognized key: \"confirmPassword\""
 *
 * Those describe a parser, not a mistake a person made. Every machine-generated
 * message is therefore replaced with wording a visitor can act on, derived from
 * the issue's own structured fields (`minimum`, `format`, …) rather than from its
 * prose. The mapping is exhaustive over Zod's issue codes with a safe default, so
 * a Zod upgrade that adds a code degrades to a generic sentence instead of
 * reintroducing a leak.
 *
 * `custom` issues are the one exception and pass through untouched: they come
 * from `.refine()` calls in this codebase whose messages are already written for
 * the person filling the form ("must be a valid E.164 phone number"). Keep them
 * that way — a custom message that reads like a parser error should be fixed at
 * the schema, not laundered here.
 */
import type { z } from "zod"

import { AppError } from "./errorCatalog.js"

/**
 * The element type of `ZodError.issues`, taken from the error itself rather than
 * imported by name so a Zod release that renames the exported issue type does not
 * break this module.
 */
type ZodIssue = z.ZodError["issues"][number]

const GENERIC = "This value is not valid."
const REQUIRED = "This field is required."

/** `minimum`/`maximum` are `number | bigint`; render both the same way. */
const bound = (value: number | bigint): string => String(value)

const tooSmall = (issue: Extract<ZodIssue, { code: "too_small" }>): string => {
  const limit = bound(issue.minimum)
  if (issue.origin === "string") return `Must be at least ${limit} characters.`
  if (issue.origin === "array" || issue.origin === "set") return `Must have at least ${limit} items.`
  return issue.inclusive ? `Must be ${limit} or more.` : `Must be more than ${limit}.`
}

const tooBig = (issue: Extract<ZodIssue, { code: "too_big" }>): string => {
  const limit = bound(issue.maximum)
  if (issue.origin === "string") return `Must be at most ${limit} characters.`
  if (issue.origin === "array" || issue.origin === "set") return `Must have at most ${limit} items.`
  return issue.inclusive ? `Must be ${limit} or less.` : `Must be less than ${limit}.`
}

/**
 * Deliberately does not echo `issue.pattern`. A regex source is an internal
 * detail, it is meaningless to a visitor, and for the formats that matter here a
 * purpose-written sentence is more useful than any generated one.
 */
const invalidFormat = (issue: Extract<ZodIssue, { code: "invalid_format" }>): string => {
  switch (issue.format) {
    case "email":
      return "Enter a valid email address."
    case "url":
      return "Enter a valid web address."
    case "uuid":
    case "guid":
      return "Enter a valid identifier."
    case "datetime":
    case "date":
    case "time":
      return "Enter a valid date."
    default:
      return "This value is not in the expected format."
  }
}

/**
 * `z.literal(true)` — used for the consent acknowledgement — is the only shape of
 * this issue the public surface produces, and "expected true" is not something to
 * show a person. Allowed values are not listed for the general case: for a closed
 * enum they are already public in the API contract, but this mapper cannot tell a
 * public enum from an internal one, so it stays quiet.
 */
const invalidValue = (issue: Extract<ZodIssue, { code: "invalid_value" }>): string => {
  const [only] = issue.values
  if (issue.values.length === 1 && only === true) return "This must be accepted to continue."
  return "This value is not one of the allowed options."
}

const safeMessage = (issue: ZodIssue): string => {
  switch (issue.code) {
    // Written at the schema for the person filling the form; see the header note.
    case "custom":
      return issue.message
    /*
     * A missing field and a wrongly-typed one are the same Zod code, and the
     * difference is the one thing the visitor needs: `input === undefined` means
     * they left it out. Checked by value rather than by key presence so an
     * explicit `undefined` in the JSON reads as absent too.
     */
    case "invalid_type":
      return issue.input === undefined ? REQUIRED : GENERIC
    case "too_small":
      return tooSmall(issue)
    case "too_big":
      return tooBig(issue)
    case "invalid_format":
      return invalidFormat(issue)
    case "invalid_value":
      return invalidValue(issue)
    case "not_multiple_of":
      return `Must be a multiple of ${bound(issue.divisor)}.`
    /*
     * A strict-object violation. The offending key names are the caller's own
     * input, so echoing them would not leak anything — they are left out because
     * this message reaches a visitor, and the caller already has its own request
     * body to compare against.
     */
    case "unrecognized_keys":
      return "The request contained fields that are not accepted."
    default:
      return GENERIC
  }
}

/**
 * Convert a ZodError into public `field -> messages` using dotted paths.
 *
 * `_root` collects issues with no path — chiefly strict-object violations, which
 * are not attributable to any single input and so must not be rendered against
 * one.
 */
export const zodFieldErrors = (error: z.ZodError): Record<string, string[]> => {
  const fields: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "_root" : issue.path.map((part) => String(part)).join(".")
    const messages = (fields[path] ??= [])
    const message = safeMessage(issue)
    // Two different issues on one field can now map onto the same sentence (a
    // min and a max violation both become "This value is not valid." under the
    // default). Repeating it tells the reader nothing.
    if (!messages.includes(message)) messages.push(message)
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
