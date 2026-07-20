/**
 * Operational health + readiness (spec 05 §9, 04 §6.1). `/health/live` (in
 * createApplication) is database-independent. `/health/ready` reports readiness
 * without exposing any configuration value: it is degraded until the database is
 * reachable and email is configured. `/v1/health` is the versioned envelope
 * health. Readiness never leaks secrets, versions, or connection strings.
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

/** Aggregate the readiness signal from its component checks. */
export const buildReadinessReport = (database: boolean, emailConfigured: boolean): ReadinessReport => ({
  ready: database && emailConfigured,
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
