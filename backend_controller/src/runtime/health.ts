/**
 * Operational health + readiness (spec 05 §9, 04 §6.1). `/health/live` (in
 * createApplication) is database-independent. `/health/ready` reports readiness
 * without exposing any configuration value: it is degraded until the database is
 * reachable. Email configuration is reported as an informational check (email
 * transport is optional/out-of-band, so it does not gate readiness). `/v1/health`
 * is the versioned envelope health. Readiness never leaks secrets or values.
 *
 * Two separate email signals, because they answer different questions and were
 * previously conflated into one. `emailTransportConfigured` is whether outbound
 * mail can be sent at all (SMTP host + credentials). `emailEventIngressConfigured`
 * is whether the SES/SNS side is set up to report bounces and complaints back.
 * Reporting only the latter as "email" was actively misleading: a deployment
 * sending mail perfectly over SMTP with no SES variables reported `email: false`,
 * and one with SES variables but no SMTP — which cannot send a single message —
 * reported `email: true`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { sql } from "kysely"
import type { Kysely } from "kysely"

import type { Database } from "../db/types.js"
import { renderMetrics, type MetricsDeps } from "./metrics.js"

export interface ReadinessReport {
  readonly ready: boolean
  readonly database: boolean
  /** Outbound SMTP transport is configured, so mail can actually be sent. */
  readonly emailTransportConfigured: boolean
  /** SES/SNS delivery-event ingress is configured (bounces, complaints). */
  readonly emailEventIngressConfigured: boolean
}

/**
 * Aggregate the readiness signal. The database is the hard readiness gate; the
 * email flags are reported for observability but do not gate readiness, because
 * mail is dispatched out-of-band by the worker and a send outage does not make the
 * API unable to serve requests.
 */
export const buildReadinessReport = (
  database: boolean,
  emailTransportConfigured: boolean,
  emailEventIngressConfigured: boolean,
): ReadinessReport => ({
  ready: database,
  database,
  emailTransportConfigured,
  emailEventIngressConfigured,
})

/** Build a readiness check that pings the database and reads the email-config flags. */
export const createReadinessCheck =
  (
    database: Kysely<Database>,
    emailTransportConfigured: boolean,
    emailEventIngressConfigured: boolean,
  ) =>
  async (): Promise<ReadinessReport> => {
    let databaseReachable = false
    try {
      await sql`select 1`.execute(database)
      databaseReachable = true
    } catch {
      databaseReachable = false
    }
    return buildReadinessReport(databaseReachable, emailTransportConfigured, emailEventIngressConfigured)
  }

export interface HealthRouteDeps {
  readonly checkReadiness: () => Promise<ReadinessReport>
  readonly metrics?: MetricsDeps
}

export const registerHealthRoutes = (application: FastifyInstance, deps: HealthRouteDeps): void => {
  application.get("/health/ready", async (_request, reply) => {
    const report = await deps.checkReadiness()
    return reply.code(report.ready ? 200 : 503).send({
      status: report.ready ? "ready" : "degraded",
      checks: {
        database: report.database,
        emailTransport: report.emailTransportConfigured,
        emailEventIngress: report.emailEventIngressConfigured,
      },
    })
  })

  application.get("/v1/health", async (_request, reply) => reply.sendData({ status: "ok" }))

  if (deps.metrics !== undefined) {
    application.get("/metrics", async (request: FastifyRequest, reply: FastifyReply) => {
      const { body, status } = await renderMetrics(deps.metrics as MetricsDeps, request.ip)
      return reply.code(status).send(body)
    })
  }
}
