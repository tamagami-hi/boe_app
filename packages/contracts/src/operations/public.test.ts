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

const expectRejected = (
  schema: { safeParse: (value: unknown) => { success: boolean } },
  values: readonly unknown[],
) => {
  for (const value of values) {
    expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false)
  }
}

describe("public operation descriptors", () => {
  it("exports one immutable descriptor for each exact public route", () => {
    expect(PUBLIC_OPERATIONS).toEqual([getPublicConsentDocuments])
    expect(PUBLIC_OPERATIONS).toHaveLength(1)

    expect(getPublicConsentDocuments).toMatchObject({
      operationId: "getPublicConsentDocuments",
      method: "GET",
      path: "/v1/public/consent-documents",
      authChannel: "public",
      credentialPolicy: "none",
      idempotency: "none",
      success: { status: 200 },
      errorCodes: ["RATE_LIMITED", "INTERNAL_ERROR", "DEPENDENCY_UNAVAILABLE"],
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

    const mutableOperation = getPublicConsentDocuments as unknown as { operationId: string }
    const mutableErrors = getPublicConsentDocuments.errorCodes as unknown as string[]
    expect(() => {
      mutableOperation.operationId = "changed"
    }).toThrow(TypeError)
    expect(() => mutableErrors.push("ACTIVE_APPLICATION_EXISTS")).toThrow(TypeError)
  })

  it("exports identical public contracts from the package root", () => {
    expect(Contracts.PUBLIC_OPERATIONS).toBe(PUBLIC_OPERATIONS)
    expect(Contracts.getPublicConsentDocuments).toBe(getPublicConsentDocuments)
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

describe("public contract JSON Schema", () => {
  it("keeps all public schemas representable and strict", () => {
    for (const schema of [ConsentDocumentsData, ConsentDocumentsSuccessEnvelope]) {
      const jsonSchema = z.toJSONSchema(schema, { io: "output" })
      expect(JSON.stringify(jsonSchema)).toContain('"additionalProperties":false')
    }
  })

  it("preserves path safety and exact-one-kind tuple alternatives", () => {
    const pathSchema = z.toJSONSchema(PublicPath, { io: "output" }) as { pattern?: string }
    const consentSchema = z.toJSONSchema(ConsentDocumentsData, { io: "output" })
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
    for (const schema of [ConsentDocumentsData]) {
      const serialized = JSON.stringify(z.toJSONSchema(schema, { io: "output" }))
      expect(serialized).not.toContain('"applicationId"')
      expect(serialized).not.toContain('"format":"uuid"')
    }
  })
})
