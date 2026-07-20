import { z } from "zod"
import { describe, expect, expectTypeOf, it } from "vitest"

import * as Contracts from "../index.js"
import { ERROR_DEFINITIONS, ErrorCode } from "../errors.js"
import {
  ConsentDocumentsData,
  ConsentDocumentsSuccessEnvelope,
  getPublicConsentDocuments,
  PUBLIC_OPERATIONS,
  PublicPath,
  SubmitApplicationBody,
  SubmitApplicationData,
  SubmitApplicationHeaders,
  SubmitApplicationSuccessEnvelope,
  submitApplication,
  VerifyApplicationEmailBody,
  VerifyApplicationEmailData,
  VerifyApplicationEmailSuccessEnvelope,
  verifyApplicationEmail,
} from "./public.js"

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000"
const TIMESTAMP = "2026-07-20T10:30:00Z"
const SHA_256 = "a".repeat(64)

const createMeta = () => ({ requestId: REQUEST_ID, timestamp: TIMESTAMP })
const createConsentDocument = (kind: "terms" | "privacy") => ({
  kind,
  version: `${kind}_v1`,
  publicPath: `/legal/${kind}`,
  contentMarkdown: `# ${kind}`,
  sha256: SHA_256,
})
const createConsent = (kind: "terms" | "privacy") => ({
  kind,
  version: `${kind}_v1`,
  accepted: true,
})
const createApplicationBody = () => ({
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+919876543210",
  consents: [createConsent("terms"), createConsent("privacy")],
})

const expectRejected = (
  schema: { safeParse: (value: unknown) => { success: boolean } },
  values: readonly unknown[],
) => {
  for (const value of values) {
    expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false)
  }
}

describe("public operation descriptors", () => {
  it("exports one immutable descriptor for each exact public onboarding route", () => {
    expect(PUBLIC_OPERATIONS).toEqual([
      getPublicConsentDocuments,
      submitApplication,
      verifyApplicationEmail,
    ])
    expect(PUBLIC_OPERATIONS).toHaveLength(3)

    expect(getPublicConsentDocuments).toMatchObject({
      operationId: "getPublicConsentDocuments",
      method: "GET",
      path: "/v1/public/consent-documents",
      authChannel: "public",
      idempotency: "none",
      success: { status: 200 },
      errorCodes: ["RATE_LIMITED", "INTERNAL_ERROR", "DEPENDENCY_UNAVAILABLE"],
    })
    expect(submitApplication).toMatchObject({
      operationId: "submitApplication",
      method: "POST",
      path: "/v1/applications",
      authChannel: "public",
      idempotency: "required",
      request: { mediaType: "application/json", maxBodyBytes: 65_536 },
      success: { status: 202 },
      errorCodes: [
        "VALIDATION_FAILED",
        "STATE_CONFLICT",
        "IDEMPOTENCY_KEY_REUSED",
        "IDEMPOTENCY_IN_PROGRESS",
        "PAYLOAD_TOO_LARGE",
        "UNSUPPORTED_MEDIA_TYPE",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
        "DEPENDENCY_UNAVAILABLE",
      ],
    })
    expect(verifyApplicationEmail).toMatchObject({
      operationId: "verifyApplicationEmail",
      method: "POST",
      path: "/v1/applications/verify-email",
      authChannel: "public-token",
      idempotency: "single-use-token",
      request: { mediaType: "application/json", maxBodyBytes: 65_536 },
      success: { status: 200 },
      errorCodes: [
        "VALIDATION_FAILED",
        "TOKEN_INVALID",
        "TOKEN_ALREADY_USED",
        "TOKEN_EXPIRED",
        "PAYLOAD_TOO_LARGE",
        "UNSUPPORTED_MEDIA_TYPE",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
        "DEPENDENCY_UNAVAILABLE",
      ],
    })
  })

  it("keeps operation IDs and method/path pairs unique", () => {
    const operationIds = PUBLIC_OPERATIONS.map(({ operationId }) => operationId)
    const routes = PUBLIC_OPERATIONS.map(({ method, path }) => `${method} ${path}`)

    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it("preserves each descriptor's exact request type", () => {
    expectTypeOf<
      "body" extends keyof typeof getPublicConsentDocuments.request ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      "headers" extends keyof typeof getPublicConsentDocuments.request ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      "mediaType" extends keyof typeof getPublicConsentDocuments.request ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      "headers" extends keyof typeof verifyApplicationEmail.request ? true : false
    >().toEqualTypeOf<false>()

    const submitBodySchema: typeof SubmitApplicationBody = submitApplication.request.body
    const submitHeaderSchema: typeof SubmitApplicationHeaders =
      submitApplication.request.headers
    const verificationBodySchema: typeof VerifyApplicationEmailBody =
      verifyApplicationEmail.request.body

    expect(submitBodySchema).toBe(SubmitApplicationBody)
    expect(submitHeaderSchema).toBe(SubmitApplicationHeaders)
    expect(verificationBodySchema).toBe(VerifyApplicationEmailBody)
  })

  it("publishes only canonical public error codes without duplicates", () => {
    for (const operation of PUBLIC_OPERATIONS) {
      expect(new Set(operation.errorCodes).size, operation.operationId).toBe(
        operation.errorCodes.length,
      )
      for (const code of operation.errorCodes) {
        expect(ErrorCode.parse(code)).toBe(code)
        expect(ERROR_DEFINITIONS[code]).toBeDefined()
      }
      expect(operation.errorCodes).not.toContain("ACTIVE_APPLICATION_EXISTS")
    }
  })

  it("deeply freezes descriptor policy and the ordered registry", () => {
    expect(Object.isFrozen(PUBLIC_OPERATIONS)).toBe(true)
    for (const operation of PUBLIC_OPERATIONS) {
      expect(Object.isFrozen(operation)).toBe(true)
      expect(Object.isFrozen(operation.request)).toBe(true)
      expect(Object.isFrozen(operation.success)).toBe(true)
      expect(Object.isFrozen(operation.errorCodes)).toBe(true)
    }

    const mutableOperation = submitApplication as unknown as { operationId: string }
    const mutableErrors = submitApplication.errorCodes as unknown as string[]
    expect(() => {
      mutableOperation.operationId = "changed"
    }).toThrow(TypeError)
    expect(() => mutableErrors.push("ACTIVE_APPLICATION_EXISTS")).toThrow(TypeError)
  })

  it("exports identical public contracts from the package root", () => {
    expect(Contracts.PUBLIC_OPERATIONS).toBe(PUBLIC_OPERATIONS)
    expect(Contracts.submitApplication).toBe(submitApplication)
    expect(Contracts.VerifyApplicationEmailBody).toBe(VerifyApplicationEmailBody)
  })
})

describe("public consent document contract", () => {
  it.each([
    [createConsentDocument("terms"), createConsentDocument("privacy")],
    [createConsentDocument("privacy"), createConsentDocument("terms")],
  ])("accepts exactly one strict document per kind in either order", (...items) => {
    expect(ConsentDocumentsData.parse({ items })).toEqual({ items })
  })

  it("rejects missing, duplicate, extra, or non-strict consent documents", () => {
    const terms = createConsentDocument("terms")
    const privacy = createConsentDocument("privacy")

    expectRejected(ConsentDocumentsData, [
      { items: [terms] },
      { items: [terms, terms] },
      { items: [terms, privacy, terms] },
      { items: [{ ...terms, extra: true }, privacy] },
      { items: [terms, privacy], extra: true },
      { items: null },
    ])
  })

  it("validates canonical root-relative public paths", () => {
    for (const path of ["/", "/terms", "/legal/terms-v1.2", "/legal/%E2%82%AC"]) {
      expect(PublicPath.parse(path)).toBe(path)
    }

    expectRejected(PublicPath, [
      "//evil.example/x",
      "/.",
      "/..",
      "/./x",
      "/a/../b",
      "/a/.",
      "/a/..",
      "/a?x=1",
      "/a#fragment",
      "/a\\b",
      "/a%",
      "/%e2%82%ac",
      "/%2F",
      "/%2f",
      "/%5C",
      "/%5c",
      "/%2E",
      "/%2e",
      "/%2E.",
      "/%252F",
      "/%255C",
      "/%252E",
      "https://example.com/terms",
      "terms",
    ])
  })

  it("rejects invalid document content and digest fields", () => {
    const terms = createConsentDocument("terms")
    const privacy = createConsentDocument("privacy")

    expectRejected(ConsentDocumentsData, [
      { items: [{ ...terms, contentMarkdown: "" }, privacy] },
      { items: [{ ...terms, sha256: "A".repeat(64) }, privacy] },
      { items: [{ ...terms, sha256: "a".repeat(63) }, privacy] },
      { items: [{ ...terms, version: "bad version" }, privacy] },
      { items: [{ ...terms, publicPath: "//example.com/terms" }, privacy] },
    ])
  })

  it("parses only the strict full success envelope", () => {
    const value = {
      ok: true,
      data: { items: [createConsentDocument("terms"), createConsentDocument("privacy")] },
      error: null,
      meta: createMeta(),
    }

    expect(ConsentDocumentsSuccessEnvelope.safeParse(value).success).toBe(true)
    expect(
      ConsentDocumentsSuccessEnvelope.safeParse({ ...value, data: { ...value.data, extra: true } })
        .success,
    ).toBe(false)
  })
})

describe("application submission contract", () => {
  it("accepts strict input with one accepted consent per kind in either order", () => {
    const termsFirst = createApplicationBody()
    const privacyFirst = { ...termsFirst, consents: [...termsFirst.consents].reverse() }

    expect(SubmitApplicationBody.parse(termsFirst)).toEqual(termsFirst)
    expect(SubmitApplicationBody.parse(privacyFirst)).toEqual(privacyFirst)
  })

  it("reuses scalar normalization at the request boundary", () => {
    const value = {
      ...createApplicationBody(),
      fullName: "  Ada Lovelace  ",
      email: "  Ada@example.com  ",
      phone: "  +919876543210  ",
    }

    expect(SubmitApplicationBody.parse(value)).toMatchObject({
      fullName: "Ada Lovelace",
      email: "Ada@example.com",
      phone: "+919876543210",
    })
  })

  it("rejects duplicate, missing, extra, false, null, or non-strict consent evidence", () => {
    const body = createApplicationBody()
    const terms = createConsent("terms")
    const privacy = createConsent("privacy")

    expectRejected(SubmitApplicationBody, [
      { ...body, consents: [terms] },
      { ...body, consents: [terms, terms] },
      { ...body, consents: [terms, privacy, terms] },
      { ...body, consents: [{ ...terms, accepted: false }, privacy] },
      { ...body, consents: [{ ...terms, accepted: null }, privacy] },
      { ...body, consents: [{ ...terms, extra: true }, privacy] },
      { ...body, consents: null },
    ])
  })

  it("rejects internal, credential, compliance, and financial input fields", () => {
    const body = createApplicationBody()

    for (const forbiddenKey of [
      "applicationId",
      "clientTimestamp",
      "ipAddress",
      "password",
      "pan",
      "kyc",
      "riskAnswers",
      "investmentAmount",
    ]) {
      expect(SubmitApplicationBody.safeParse({ ...body, [forbiddenKey]: "forbidden" }).success).toBe(
        false,
      )
    }
  })

  it("requires only the normalized idempotency header projection", () => {
    expect(SubmitApplicationHeaders.parse({ "idempotency-key": "request1" })).toEqual({
      "idempotency-key": "request1",
    })
    expectRejected(SubmitApplicationHeaders, [
      {},
      { "idempotency-key": "short" },
      { "Idempotency-Key": "request1" },
      { "idempotency-key": "request1", authorization: "forbidden" },
    ])
  })

  it("returns only the generic enumeration-safe accepted envelope", () => {
    const value = {
      ok: true,
      data: { accepted: true },
      error: null,
      meta: createMeta(),
    }

    expect(SubmitApplicationSuccessEnvelope.safeParse(value).success).toBe(true)
    for (const forbiddenKey of ["applicationId", "state", "expiresAt", "duplicate", "outcome"]) {
      expect(
        SubmitApplicationSuccessEnvelope.safeParse({
          ...value,
          data: { ...value.data, [forbiddenKey]: "forbidden" },
        }).success,
      ).toBe(false)
    }
  })
})

describe("email verification contract", () => {
  it("accepts exactly 43 untrimmed base64url characters", () => {
    const token = "a".repeat(43)
    expect(VerifyApplicationEmailBody.parse({ token })).toEqual({ token })

    expectRejected(VerifyApplicationEmailBody, [
      { token: "a".repeat(42) },
      { token: "a".repeat(44) },
      { token: `${"a".repeat(42)}=` },
      { token: `${"a".repeat(42)}+` },
      { token: `${"a".repeat(42)}/` },
      { token: ` ${"a".repeat(43)}` },
      { token: "a".repeat(43), extra: true },
      { token: null },
      { token: 43 },
    ])
  })

  it("returns only the generic verified envelope without application state", () => {
    const value = {
      ok: true,
      data: { verified: true },
      error: null,
      meta: createMeta(),
    }

    expect(VerifyApplicationEmailSuccessEnvelope.safeParse(value).success).toBe(true)
    for (const forbiddenKey of ["applicationId", "state", "outcome"]) {
      expect(
        VerifyApplicationEmailSuccessEnvelope.safeParse({
          ...value,
          data: { ...value.data, [forbiddenKey]: "forbidden" },
        }).success,
      ).toBe(false)
    }
  })
})

describe("public contract JSON Schema", () => {
  it("keeps all public schemas representable and strict", () => {
    for (const schema of [
      ConsentDocumentsData,
      ConsentDocumentsSuccessEnvelope,
      SubmitApplicationBody,
      SubmitApplicationHeaders,
      SubmitApplicationData,
      SubmitApplicationSuccessEnvelope,
      VerifyApplicationEmailBody,
      VerifyApplicationEmailData,
      VerifyApplicationEmailSuccessEnvelope,
    ]) {
      const jsonSchema = z.toJSONSchema(schema, { io: "output" })
      expect(JSON.stringify(jsonSchema)).toContain('"additionalProperties":false')
    }
  })

  it("keeps request schemas representable and strict in input mode", () => {
    for (const schema of [
      SubmitApplicationBody,
      SubmitApplicationHeaders,
      VerifyApplicationEmailBody,
    ]) {
      const jsonSchema = z.toJSONSchema(schema, { io: "input" })
      expect(JSON.stringify(jsonSchema)).toContain('"additionalProperties":false')
    }
  })

  it("preserves path safety and exact-one-kind tuple alternatives", () => {
    const pathSchema = z.toJSONSchema(PublicPath, { io: "output" }) as { pattern?: string }
    const consentSchema = z.toJSONSchema(SubmitApplicationBody, { io: "output" })
    const serializedConsentSchema = JSON.stringify(consentSchema)

    expect(pathSchema.pattern).toBe(
      "^(?!\\/\\/)(?!.*\\/\\.{1,2}(?:\\/|$))(?!.*%(?:25|2F|5C|2E))\\/(?:[A-Za-z0-9._~!$&'()*+,;=:@\\/-]|%[0-9A-F]{2})*$",
    )
    expect(serializedConsentSchema).toContain('"prefixItems"')
    expect(serializedConsentSchema).toContain('"minItems":2')
    expect(serializedConsentSchema).toContain('"maxItems":2')
    expect(serializedConsentSchema).toContain('"const":"terms"')
    expect(serializedConsentSchema).toContain('"const":"privacy"')
  })

  it("keeps public success data free of application identifiers and UUID fields", () => {
    for (const schema of [ConsentDocumentsData, SubmitApplicationData, VerifyApplicationEmailData]) {
      const serialized = JSON.stringify(z.toJSONSchema(schema, { io: "output" }))
      expect(serialized).not.toContain('"applicationId"')
      expect(serialized).not.toContain('"format":"uuid"')
    }
  })
})
