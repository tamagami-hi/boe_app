import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, test } from "vitest"

import { createApplication } from "../runtime/application.js"

import { AppError } from "./errorCatalog.js"
import { resolveRequestId } from "./boundary.js"

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000"

interface TestEnvelope {
  ok: boolean
  data: unknown
  error: { code: string; retryable: boolean; fields?: Record<string, string[]> } | null
  meta: { requestId: string; timestamp: string; idempotencyReplay?: boolean }
}

const envelopeOf = (response: { json: () => unknown }): TestEnvelope => response.json() as TestEnvelope

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const buildApp = (): FastifyInstance =>
  createApplication({
    logger: false,
    registerRoutes: (application) => {
      application.post("/v1/echo", (_request, reply) => reply.sendData({ echoed: true }))
      application.post("/v1/boom", () => {
        throw new AppError("STATE_CONFLICT")
      })
    },
  })

describe("resolveRequestId", () => {
  test("keeps a valid incoming UUID and replaces an invalid one", () => {
    expect(resolveRequestId(VALID_UUID)).toBe(VALID_UUID)
    expect(resolveRequestId("not-a-uuid")).not.toBe("not-a-uuid")
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/u)
  })
})

describe("HTTP boundary", () => {
  test("keeps the operational liveness endpoint outside the envelope", async () => {
    app = buildApp()
    const response = await app.inject({ method: "GET", url: "/health/live" })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: "ok" })
    expect(response.headers["x-request-id"]).toBeDefined()
    expect(response.headers["cache-control"]).toBe("no-store")
  })

  test("renders unknown routes as a RESOURCE_NOT_FOUND envelope", async () => {
    app = buildApp()
    const response = await app.inject({ method: "GET", url: "/v1/nope" })
    expect(response.statusCode).toBe(404)
    const body = envelopeOf(response)
    expect(body.ok).toBe(false)
    expect(body.error?.code).toBe("RESOURCE_NOT_FOUND")
    expect(body.meta.requestId).toBe(response.headers["x-request-id"])
  })

  test("echoes a valid incoming request id and replaces an invalid one", async () => {
    app = buildApp()
    const echoed = await app.inject({
      method: "GET",
      url: "/v1/nope",
      headers: { "x-request-id": VALID_UUID },
    })
    expect(echoed.headers["x-request-id"]).toBe(VALID_UUID)
    expect(envelopeOf(echoed).meta.requestId).toBe(VALID_UUID)

    const replaced = await app.inject({
      method: "GET",
      url: "/v1/nope",
      headers: { "x-request-id": "bogus" },
    })
    expect(replaced.headers["x-request-id"]).not.toBe("bogus")
  })

  test("sends a success envelope via reply.sendData", async () => {
    app = buildApp()
    const response = await app.inject({ method: "POST", url: "/v1/echo", payload: {} })
    expect(response.statusCode).toBe(200)
    const body = envelopeOf(response)
    expect(body).toMatchObject({ ok: true, data: { echoed: true }, error: null })
    expect(body.meta.requestId).toBeDefined()
  })

  test("maps a thrown AppError to its stable status and envelope", async () => {
    app = buildApp()
    const response = await app.inject({ method: "POST", url: "/v1/boom", payload: {} })
    expect(response.statusCode).toBe(409)
    expect(envelopeOf(response).error).toMatchObject({ code: "STATE_CONFLICT", retryable: true })
  })

  test("rejects an oversized body with 413 PAYLOAD_TOO_LARGE", async () => {
    app = buildApp()
    const response = await app.inject({
      method: "POST",
      url: "/v1/echo",
      payload: { big: "a".repeat(70_000) },
    })
    expect(response.statusCode).toBe(413)
    expect(envelopeOf(response).error?.code).toBe("PAYLOAD_TOO_LARGE")
  })

  test("rejects an unsupported media type with 415", async () => {
    app = buildApp()
    const response = await app.inject({
      method: "POST",
      url: "/v1/echo",
      headers: { "content-type": "application/xml" },
      payload: "<x/>",
    })
    expect(response.statusCode).toBe(415)
    expect(envelopeOf(response).error?.code).toBe("UNSUPPORTED_MEDIA_TYPE")
  })
})
