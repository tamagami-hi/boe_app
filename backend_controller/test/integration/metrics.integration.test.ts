import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { registerHealthRoutes } from "../../src/runtime/health.js"
import { createApplication } from "../../src/runtime/application.js"
import { createMetricsRepository } from "../../src/repositories/metricsRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

describe("metrics endpoint (integration)", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
      .start()
    pool = createPool({
      connectionString: container.getConnectionUri(),
      poolMax: 5,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 10_000,
    })
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    await runMigrations(pool, await loadMigrationFiles(directory))

    const database = createDatabase(pool)
    app = createApplication({
      logger: false,
      registerRoutes: (instance) =>
        registerHealthRoutes(instance, {
          checkReadiness: () =>
            Promise.resolve({ ready: true, database: true, emailTransportConfigured: true, emailEventIngressConfigured: true }),
          metrics: { repository: createMetricsRepository(database), clock: () => new Date("2026-08-24T10:00:00.000Z") },
        }),
    })
  }, 200_000)

  afterAll(async () => {
    await app.close()
    await pool.end()
    await container.stop()
  })

  test("/metrics exposes worker backlog and mandate stale counts from loopback", async () => {
    const response = await app.inject({ method: "GET", url: "/metrics" })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain("boe_worker_backlog_count")
    expect(response.body).toContain("boe_mandate_setup_stale_count")
    expect(response.body).toContain("boe_mandate_collection_stale_count")
    expect(response.body).toContain("boe_mandate_cancel_reconciliation_required_count")
  })

  test("/metrics exposes heartbeats after they are recorded", async () => {
    const workerName = `test-worker-${randomUUID()}`
    await pool.query(
      "insert into worker_heartbeats (worker_name, pass_started_at, pass_completed_at, success, summary, error_code) values ($1, now(), now(), true, '{}', null)",
      [workerName],
    )

    const response = await app.inject({ method: "GET", url: "/metrics" })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain(`worker="${workerName}"`)
    expect(response.body).toContain("boe_worker_last_success_timestamp_seconds")
    expect(response.body).toMatch(new RegExp(`boe_worker_last_success\\{worker="${workerName}"\\} 1`))
  })
})
