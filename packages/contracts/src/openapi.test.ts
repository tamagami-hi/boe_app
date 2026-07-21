import { describe, expect, test } from "vitest"

import { ALL_OPERATIONS, buildOpenApiDocument } from "../scripts/generate-openapi.js"

describe("buildOpenApiDocument", () => {
  test("is deterministic across runs", () => {
    const first = JSON.stringify(buildOpenApiDocument())
    const second = JSON.stringify(buildOpenApiDocument())
    expect(first).toBe(second)
  })

  test("emits an OpenAPI 3.1 document with the expected info", () => {
    const document = buildOpenApiDocument()
    expect(document.openapi).toBe("3.1.0")
    expect(document.info.title).toBe("BeOnEdge API")
    expect(document.info.version).toBe("v1")
  })

  test("registers every operation exactly once with a unique operationId", () => {
    const operationIds = ALL_OPERATIONS.map((operation) => operation.operationId)
    expect(new Set(operationIds).size).toBe(operationIds.length)

    const pathKeys = ALL_OPERATIONS.map((operation) => `${operation.method} ${operation.path}`)
    expect(new Set(pathKeys).size).toBe(pathKeys.length)
  })

  test("documents each operation path/method with its operationId", () => {
    const document = buildOpenApiDocument()
    for (const operation of ALL_OPERATIONS) {
      const method = operation.method.toLowerCase()
      const pathItem = document.paths?.[operation.path]
      expect(pathItem, `missing path ${operation.path}`).toBeDefined()
      const definition = (pathItem as Record<string, { operationId?: string }>)[method]
      expect(definition?.operationId).toBe(operation.operationId)
    }
  })

  test("hoists one shared ErrorEnvelope component and $refs it for error statuses", () => {
    const document = buildOpenApiDocument()
    expect(document.components?.schemas?.ErrorEnvelope).toBeDefined()
    expect(JSON.stringify(document.components?.schemas?.ErrorEnvelope)).toContain("retryable")

    const pathItem = document.paths?.["/v1/applications"] as
      | Record<string, { responses?: Record<string, unknown> }>
      | undefined
    const responses = pathItem?.post?.responses ?? {}
    expect(Object.keys(responses)).toContain("409")
    expect(JSON.stringify(responses)).toContain("#/components/schemas/ErrorEnvelope")
  })

  test("documents modeled request headers as required parameters", () => {
    const document = buildOpenApiDocument()

    const submit = document.paths?.["/v1/applications"] as
      | Record<string, { parameters?: { name: string; in: string; required?: boolean }[] }>
      | undefined
    const idempotency = (submit?.post?.parameters ?? []).find(
      (parameter) => parameter.name === "idempotency-key",
    )
    expect(idempotency).toBeDefined()
    expect(idempotency?.in).toBe("header")
    expect(idempotency?.required).toBe(true)

    const login = document.paths?.["/v1/auth/native/login"] as
      | Record<string, { parameters?: { name: string }[] }>
      | undefined
    const loginHeaderNames = (login?.post?.parameters ?? []).map((parameter) => parameter.name)
    expect(loginHeaderNames).toContain("x-client-platform")
    expect(loginHeaderNames).toContain("x-app-version")
  })

  test("keeps every public operation free of internal identifier fields", () => {
    const document = buildOpenApiDocument()
    for (const path of [
      "/v1/public/consent-documents",
      "/v1/applications",
      "/v1/applications/verify-email",
    ]) {
      const serialized = JSON.stringify(document.paths?.[path])
      expect(serialized, `${path} leaks applicationId`).not.toContain("applicationId")
      expect(serialized, `${path} leaks userId`).not.toContain("userId")
    }
  })
})
