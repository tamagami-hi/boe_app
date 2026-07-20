import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, test } from "vitest"

import { createApplication } from "./application.js"
import { buildReadinessReport, registerHealthRoutes, type ReadinessReport } from "./health.js"

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

const buildApp = (report: ReadinessReport): FastifyInstance =>
  createApplication({
    logger: false,
    registerRoutes: (instance) => registerHealthRoutes(instance, { checkReadiness: () => Promise.resolve(report) }),
  })

describe("buildReadinessReport", () => {
  test("is ready only when the database and email are both configured", () => {
    expect(buildReadinessReport(true, true).ready).toBe(true)
    expect(buildReadinessReport(true, false).ready).toBe(false)
    expect(buildReadinessReport(false, true).ready).toBe(false)
  })
})

describe("health routes", () => {
  test("readiness returns 200 when ready and 503 when degraded, without leaking values", async () => {
    app = buildApp(buildReadinessReport(true, true))
    const ready = await app.inject({ method: "GET", url: "/health/ready" })
    expect(ready.statusCode).toBe(200)
    expect(ready.json()).toEqual({ status: "ready", checks: { database: true, email: true } })
    expect(ready.body).not.toMatch(/postgres|connection|secret|password|token/iu)
    await app.close()

    app = buildApp(buildReadinessReport(false, true))
    const degraded = await app.inject({ method: "GET", url: "/health/ready" })
    expect(degraded.statusCode).toBe(503)
    expect(degraded.json<{ status: string }>().status).toBe("degraded")
  })

  test("versioned health returns the success envelope", async () => {
    app = buildApp(buildReadinessReport(true, true))
    const response = await app.inject({ method: "GET", url: "/v1/health" })
    expect(response.statusCode).toBe(200)
    expect(response.json<{ ok: boolean; data: { status: string } }>()).toMatchObject({
      ok: true,
      data: { status: "ok" },
    })
  })
})
