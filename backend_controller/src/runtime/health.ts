/**
 * Operational health + readiness (spec 05 §9, 04 §6.1). `/health/live` (in
 * createApplication) is database-independent. `/health/ready` reports readiness
 * without exposing any configuration value: it is degraded until the database is
 * reachable. Email configuration is reported as an informational check (email
 * transport is optional/out-of-band, so it does not gate readiness). `/v1/health`
 * is the versioned envelope health. Readiness never leaks secrets or values.
 */
import type { FastifyInstance } from "fastify"
import { sql } from "kysely"
import type { Kysely } from "kysely"

import type { Database } from "../db/types.js"

export interface ReadinessReport {
  readonly ready: boolean
  readonly database: boolean
  readonly emailConfigured: boolean
}

/**
 * Aggregate the readiness signal. The database is the hard readiness gate;
 * `emailConfigured` is reported for observability but does not gate readiness,
 * because email transport is optional and dispatched out-of-band by the worker.
 */
export const buildReadinessReport = (database: boolean, emailConfigured: boolean): ReadinessReport => ({
  ready: database,
  database,
  emailConfigured,
})

/** Build a readiness check that pings the database and reads the email-config flag. */
export const createReadinessCheck =
  (database: Kysely<Database>, emailConfigured: boolean) => async (): Promise<ReadinessReport> => {
    let databaseReachable = false
    try {
      await sql`select 1`.execute(database)
      databaseReachable = true
    } catch {
      databaseReachable = false
    }
    return buildReadinessReport(databaseReachable, emailConfigured)
  }

export interface HealthRouteDeps {
  readonly checkReadiness: () => Promise<ReadinessReport>
}

export const registerHealthRoutes = (application: FastifyInstance, deps: HealthRouteDeps): void => {
  application.get("/health/ready", async (_request, reply) => {
    const report = await deps.checkReadiness()
    return reply.code(report.ready ? 200 : 503).send({
      status: report.ready ? "ready" : "degraded",
      checks: { database: report.database, email: report.emailConfigured },
    })
  })

  application.get("/v1/health", async (_request, reply) => reply.sendData({ status: "ok" }))
}
