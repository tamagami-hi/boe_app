import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { consentDigest, SEED_CONSENT_DOCUMENTS } from "../../src/db/seedCatalog.js"
import { createConsentRepository } from "../../src/repositories/consentRepository.js"
import { registerPublicOnboardingRoutes } from "../../src/routes/publicOnboardingRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

interface ConsentItem {
  kind: string
  version: string
  publicPath: string
  contentMarkdown: string
  sha256: string
}

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
  const all = await loadMigrationFiles(directory)
  await runMigrations(
    pool,
    all.filter((file) => file.version >= "009"),
  )
  await runSeed(pool)

  const database = createDatabase(pool)
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerPublicOnboardingRoutes(instance, {
        database,
        consentRepository: createConsentRepository(),
      })
    },
  })
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("GET /v1/public/consent-documents (integration)", () => {
  test("returns the current terms and privacy documents with digests", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/public/consent-documents" })
    expect(response.statusCode).toBe(200)

    const body = response.json<{ ok: boolean; data: { items: ConsentItem[] } }>()
    expect(body.ok).toBe(true)

    const items = body.data.items
    expect(items.map((item) => item.kind).sort()).toEqual(["privacy", "terms"])

    for (const seeded of SEED_CONSENT_DOCUMENTS) {
      const item = items.find((candidate) => candidate.kind === seeded.kind)
      expect(item).toBeDefined()
      expect(item?.version).toBe(seeded.version)
      expect(item?.publicPath).toBe(seeded.publicPath)
      expect(item?.contentMarkdown).toBe(seeded.contentMarkdown)
      expect(item?.sha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(item?.sha256).toBe(consentDigest(seeded.contentMarkdown).toString("hex"))
    }
  })
})
