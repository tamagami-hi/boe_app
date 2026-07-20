import { z } from "zod"
import { describe, expect, expectTypeOf, it } from "vitest"

import * as Contracts from "./index.js"
import { createSuccessEnvelopeSchema, EnvelopeMeta, ErrorEnvelope } from "./envelope.js"
import { ErrorDetail } from "./envelope.js"
import { ERROR_CODES, ERROR_DEFINITIONS } from "./errors.js"

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000"
const TIMESTAMP = "2026-07-20T16:00:00+05:30"
const CANONICAL_TIMESTAMP = "2026-07-20T10:30:00.000Z"

const createMeta = () => ({ requestId: REQUEST_ID, timestamp: TIMESTAMP })

const createErrorEnvelope = (code: (typeof ERROR_CODES)[number]) => ({
  ok: false,
  data: null,
  error: {
    code,
    message: "A safe public message",
    retryable: ERROR_DEFINITIONS[code].retryable,
  },
  meta: createMeta(),
})

describe("envelope metadata", () => {
  it("exports envelope schemas from the package root", () => {
    expect(Contracts.EnvelopeMeta).toBe(EnvelopeMeta)
    expect(Contracts.ErrorEnvelope).toBe(ErrorEnvelope)
    expect(Contracts.createSuccessEnvelopeSchema).toBe(createSuccessEnvelopeSchema)
  })

  it("accepts strict metadata and canonicalizes timestamps", () => {
    expect(EnvelopeMeta.parse({ ...createMeta(), idempotencyReplay: true })).toEqual({
      requestId: REQUEST_ID,
      timestamp: CANONICAL_TIMESTAMP,
      idempotencyReplay: true,
    })
  })

  it.each([
    { timestamp: TIMESTAMP },
    { requestId: REQUEST_ID },
    { requestId: "not-a-uuid", timestamp: TIMESTAMP },
    { requestId: REQUEST_ID, timestamp: "not-a-time" },
    { ...createMeta(), idempotencyReplay: null },
    { ...createMeta(), unexpected: true },
  ])("rejects malformed metadata %#", (value) => {
    expect(EnvelopeMeta.safeParse(value).success).toBe(false)
  })
})

describe("success envelopes", () => {
  const Data = z.strictObject({ applicationId: z.string().uuid() })
  const SuccessEnvelope = createSuccessEnvelopeSchema(Data)

  it("parses strict success envelopes with schema-valid data", () => {
    const value = {
      ok: true,
      data: { applicationId: REQUEST_ID },
      error: null,
      meta: createMeta(),
    }

    expect(SuccessEnvelope.parse(value).meta.timestamp).toBe(CANONICAL_TIMESTAMP)
  })

  it.each([
    { ok: false, data: { applicationId: REQUEST_ID }, error: null, meta: createMeta() },
    { ok: true, data: { applicationId: "invalid" }, error: null, meta: createMeta() },
    { ok: true, data: { applicationId: REQUEST_ID }, error: {}, meta: createMeta() },
    { ok: true, data: { applicationId: REQUEST_ID }, meta: createMeta() },
    { ok: true, data: { applicationId: REQUEST_ID }, error: null, meta: { ...createMeta(), extra: 1 } },
    { ok: true, data: { applicationId: REQUEST_ID }, error: null, meta: createMeta(), extra: 1 },
  ])("rejects malformed success envelopes %#", (value) => {
    expect(SuccessEnvelope.safeParse(value).success).toBe(false)
  })

  it("supports declared strict metadata extensions", () => {
    const PaginatedEnvelope = createSuccessEnvelopeSchema(Data, {
      nextCursor: z.string().nullable(),
      total: z.number().int().nonnegative(),
    })

    const result = PaginatedEnvelope.parse({
      ok: true,
      data: { applicationId: REQUEST_ID },
      error: null,
      meta: { ...createMeta(), nextCursor: null, total: 1 },
    })

    expect(result.meta).toMatchObject({ nextCursor: null, total: 1 })
    expectTypeOf(result.data).toEqualTypeOf<{ applicationId: string }>()
    expectTypeOf(result.meta.nextCursor).toEqualTypeOf<string | null>()
    expect(
      PaginatedEnvelope.safeParse({
        ok: true,
        data: { applicationId: REQUEST_ID },
        error: null,
        meta: { ...createMeta(), nextCursor: null, total: 1, extra: true },
      }).success,
    ).toBe(false)
  })

  it.each(["requestId", "timestamp", "idempotencyReplay"])(
    "rejects a metadata extension that collides with reserved key %s",
    (reservedKey) => {
      expect(() => createSuccessEnvelopeSchema(Data, { [reservedKey]: z.string() })).toThrow(
        `Reserved envelope metadata key: ${reservedKey}`,
      )
    },
  )
})

describe("error envelopes", () => {
  it("accepts every code only with its canonical retryability", () => {
    for (const code of ERROR_CODES) {
      const value = createErrorEnvelope(code)

      expect(ErrorEnvelope.safeParse(value).success, code).toBe(true)
      expect(
        ErrorEnvelope.safeParse({
          ...value,
          error: { ...value.error, retryable: !value.error.retryable },
        }).success,
        `${code} inverse retryability`,
      ).toBe(false)
    }
  })

  it("accepts validation fields only for validation failures", () => {
    const validationEnvelope = createErrorEnvelope("VALIDATION_FAILED")
    const fields = { email: ["Invalid email"], "consents.0.version": ["Required"] }

    expect(
      ErrorEnvelope.safeParse({
        ...validationEnvelope,
        error: { ...validationEnvelope.error, fields },
      }).success,
    ).toBe(true)

    const conflictEnvelope = createErrorEnvelope("STATE_CONFLICT")
    expect(
      ErrorEnvelope.safeParse({
        ...conflictEnvelope,
        error: { ...conflictEnvelope.error, fields },
      }).success,
    ).toBe(false)
  })

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects prototype-sensitive validation field key %s",
    (fieldKey) => {
      const validationEnvelope = createErrorEnvelope("VALIDATION_FAILED")
      const fields = JSON.parse(`{${JSON.stringify(fieldKey)}:[\"Invalid\"]}`) as unknown

      expect(
        ErrorEnvelope.safeParse({
          ...validationEnvelope,
          error: { ...validationEnvelope.error, fields },
        }).success,
      ).toBe(false)
    },
  )

  it.each([
    { ok: true, data: null, error: createErrorEnvelope("INTERNAL_ERROR").error, meta: createMeta() },
    { ...createErrorEnvelope("INTERNAL_ERROR"), data: {} },
    { ...createErrorEnvelope("INTERNAL_ERROR"), extra: true },
    { ...createErrorEnvelope("INTERNAL_ERROR"), meta: { ...createMeta(), extra: true } },
    {
      ...createErrorEnvelope("INTERNAL_ERROR"),
      error: { ...createErrorEnvelope("INTERNAL_ERROR").error, extra: true },
    },
    {
      ...createErrorEnvelope("INTERNAL_ERROR"),
      error: { ...createErrorEnvelope("INTERNAL_ERROR").error, code: "UNKNOWN_ERROR" },
    },
    {
      ...createErrorEnvelope("VALIDATION_FAILED"),
      error: { ...createErrorEnvelope("VALIDATION_FAILED").error, fields: null },
    },
    {
      ...createErrorEnvelope("VALIDATION_FAILED"),
      error: { ...createErrorEnvelope("VALIDATION_FAILED").error, fields: { email: "Invalid" } },
    },
    {
      ...createErrorEnvelope("VALIDATION_FAILED"),
      error: { ...createErrorEnvelope("VALIDATION_FAILED").error, fields: { email: [1] } },
    },
  ])("rejects malformed error envelopes %#", (value) => {
    expect(ErrorEnvelope.safeParse(value).success).toBe(false)
  })

  it("keeps conditional error rules explicit in generated JSON Schema", () => {
    const SuccessEnvelope = createSuccessEnvelopeSchema(z.strictObject({ value: z.string() }))
    const errorSchema = z.toJSONSchema(ErrorDetail, { io: "output" }) as {
      anyOf?: Array<{
        additionalProperties?: boolean
        properties?: Record<
          string,
          { const?: unknown; enum?: unknown[]; propertyNames?: { pattern?: string } }
        >
      }>
    }

    expect(() => z.toJSONSchema(SuccessEnvelope, { io: "output" })).not.toThrow()
    expect(errorSchema.anyOf).toHaveLength(3)

    const validationVariant = errorSchema.anyOf?.find(
      (variant) => variant.properties?.code?.const === "VALIDATION_FAILED",
    )
    expect(validationVariant).toMatchObject({
      additionalProperties: false,
      properties: {
        retryable: { const: false },
        fields: {
          propertyNames: {
            pattern: "^(?!(?:__proto__|prototype|constructor)$)[\\s\\S]*$",
          },
        },
      },
    })

    const retryableVariant = errorSchema.anyOf?.find(
      (variant) => variant.properties?.retryable?.const === true,
    )
    expect(retryableVariant).toMatchObject({
      additionalProperties: false,
      properties: {
        code: {
          enum: [
            "STATE_CONFLICT",
            "IDEMPOTENCY_IN_PROGRESS",
            "RATE_LIMITED",
            "INTERNAL_ERROR",
            "DEPENDENCY_UNAVAILABLE",
          ],
        },
        retryable: { const: true },
      },
    })
    expect(retryableVariant?.properties).not.toHaveProperty("fields")

    const nonRetryableVariant = errorSchema.anyOf?.find(
      (variant) =>
        variant.properties?.retryable?.const === false &&
        Array.isArray(variant.properties.code?.enum),
    )
    expect(nonRetryableVariant?.properties).not.toHaveProperty("fields")
  })

})
