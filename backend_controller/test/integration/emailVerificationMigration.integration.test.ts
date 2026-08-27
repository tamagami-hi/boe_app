import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

let container: StartedPostgreSqlContainer
let pool: Pool

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
  const migrations = await loadMigrationFiles(directory)
  await runMigrations(pool, migrations.filter((migration) => migration.version < "040_email_verification_schema"))
})

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("email verification populated upgrade", () => {
  test("preserves a verified user and financial relationships across legacy removal", async () => {
    const userId = randomUUID()
    await pool.query(
      "insert into users (id, email_normalized, phone_e164, full_name, account_state, activated_at) values ($1, $2, $3, $4, 'active', now())",
      [userId, `${userId}@example.com`, "+14155551234", "Verified User"],
    )
    await pool.query(
      "insert into kyc_cases (user_id, state, submitted_at, decided_at, expires_at) values ($1, 'approved', now() - interval '3 days', now() - interval '2 days', now() + interval '29 days'), ($1, 'approved', now() - interval '2 days', now() - interval '1 day', now() + interval '30 days'), ($1, 'rejected', now() - interval '1 hour', now() - interval '30 minutes', null)",
      [userId],
    )
    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, created_by_user_id) values ($1, $2) returning id",
      [`migration-${userId}`, userId],
    )
    const sipPlanId = randomUUID()
    await pool.query(
      "insert into sip_plans (id, user_id, fund_id, amount_paise, debit_day) values ($1, $2, $3, $4, $5)",
      [sipPlanId, userId, fund.rows[0]!.id, 100_000, 5],
    )

    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const migrations = await loadMigrationFiles(directory)
    await runMigrations(pool, migrations.filter((migration) => migration.version >= "040_email_verification_schema"))

    const result = await pool.query<{ state: string; verified_at: Date | null }>(
      "select email_verification_state as state, email_verified_at as verified_at from users where id = $1",
      [userId],
    )
    expect(result.rows[0]).toMatchObject({ state: "verified" })
    expect(result.rows[0]?.verified_at).not.toBeNull()
    expect((await pool.query("select id from sip_plans where id = $1 and user_id = $2", [sipPlanId, userId])).rowCount).toBe(1)
    expect((await pool.query<{ legacy_table: string | null }>("select to_regclass('public.kyc_cases') as legacy_table")).rows[0]?.legacy_table).toBeNull()
  })
})
