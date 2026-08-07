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
  test("is ready when the database is reachable; email is informational only", () => {
    expect(buildReadinessReport(true, true, true).ready).toBe(true)
    // Neither email flag degrades readiness (optional/out-of-band).
    expect(buildReadinessReport(true, false, false).ready).toBe(true)
    expect(buildReadinessReport(true, false, false).emailTransportConfigured).toBe(false)
    expect(buildReadinessReport(true, false, false).emailEventIngressConfigured).toBe(false)
    // The database remains the hard readiness gate.
    expect(buildReadinessReport(false, true, true).ready).toBe(false)
  })

  test("reports the send transport and the event ingress independently", () => {
    // The distinction that matters operationally: SMTP present but no SES/SNS is a
    // deployment that sends mail and cannot hear about bounces. The reverse cannot
    // send at all. One combined flag could not tell those apart, and reported the
    // second — the broken one — as healthy.
    const sendsOnly = buildReadinessReport(true, true, false)
    expect(sendsOnly.emailTransportConfigured).toBe(true)
    expect(sendsOnly.emailEventIngressConfigured).toBe(false)

    const cannotSend = buildReadinessReport(true, false, true)
    expect(cannotSend.emailTransportConfigured).toBe(false)
    expect(cannotSend.emailEventIngressConfigured).toBe(true)
  })
})

describe("health routes", () => {
  test("readiness returns 200 when ready and 503 when degraded, without leaking values", async () => {
    app = buildApp(buildReadinessReport(true, true, true))
    const ready = await app.inject({ method: "GET", url: "/health/ready" })
    expect(ready.statusCode).toBe(200)
    expect(ready.json()).toEqual({
      status: "ready",
      checks: { database: true, emailTransport: true, emailEventIngress: true },
    })
    expect(ready.body).not.toMatch(/postgres|connection|secret|password|token/iu)
    await app.close()

    app = buildApp(buildReadinessReport(false, true, true))
    const degraded = await app.inject({ method: "GET", url: "/health/ready" })
    expect(degraded.statusCode).toBe(503)
    expect(degraded.json<{ status: string }>().status).toBe("degraded")
  })

  test("versioned health returns the success envelope", async () => {
    app = buildApp(buildReadinessReport(true, true, true))
    const response = await app.inject({ method: "GET", url: "/v1/health" })
    expect(response.statusCode).toBe(200)
    expect(response.json<{ ok: boolean; data: { status: string } }>()).toMatchObject({
      ok: true,
      data: { status: "ok" },
    })
  })
})
