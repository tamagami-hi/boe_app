import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations, type MigrationFile } from "../../src/scripts/migrate.js"

const MIGRATION = "067_client_reviews"

let container: StartedPostgreSqlContainer
let pool: Pool
let migrations: readonly MigrationFile[]
let before: string

const seedUser = async (state: "active" | "closed", tombstoned: boolean, phone: string): Promise<string> => {
  const id = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, closed_at, pii_tombstoned_at) " +
        "values ($1, $2, 'Upgrade Client', $3::user_account_state, now(), case when $3 = 'closed' then now() end, case when $4 then now() end) returning id",
      [`reviews-${randomUUID()}@example.com`, phone, state, tombstoned],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("user not seeded")
  return id
}

const seedSupportRequest = async (userId: string): Promise<void> => {
  await pool.query(
    "insert into support_requests (user_id, reference, category, subject, body) values ($1, $2, 'general', 'Statement', 'Where is my March statement?')",
    [userId, `REQ-${randomUUID().slice(0, 8).toUpperCase()}`],
  )
}

const snapshot = async (): Promise<string> =>
  JSON.stringify(
    (
      await pool.query(
        "select (select json_agg(u order by u.id) from users u) as users, " +
          "(select json_agg(s order by s.id) from support_requests s) as support, " +
          "(select json_agg(a order by a.id) from audit_events a) as audit",
      )
    ).rows[0],
  )

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 4, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations.filter((migration) => migration.version < MIGRATION))

  const active = await seedUser("active", false, "+919876510001")
  const closed = await seedUser("closed", false, "+919876510002")
  const erased = await seedUser("closed", true, "+919876510003")
  await seedSupportRequest(active)
  await seedSupportRequest(erased)
  await pool.query(
    "insert into audit_events (actor_type, actor_user_id, command, entity_type, entity_id, request_id, entity_version, metadata) " +
      "values ('user', $1, 'support.request_created', 'support_request', $1, $2, 1, '{}')",
    [closed, randomUUID()],
  )

  before = await snapshot()
  await runMigrations(pool, migrations.filter((migration) => migration.version === MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("client reviews populated upgrade", () => {
  test("adds an empty reviews table and leaves every existing row untouched", async () => {
    expect(await snapshot()).toBe(before)
    expect((await pool.query("select 1 from client_reviews")).rowCount).toBe(0)
    expect((await pool.query("select version from schema_migrations where version = $1", [MIGRATION])).rowCount).toBe(1)
  })

  test("keeps the previous release's user writes working, including setting a tombstone", async () => {
    const user = await seedUser("active", false, "+919876510004")
    await pool.query("update users set full_name = 'Renamed Client', version = version + 1 where id = $1", [user])
    await pool.query("update users set pii_tombstoned_at = now(), account_state = 'closed', closed_at = now() where id = $1", [user])
    const row = await pool.query<{ full_name: string; account_state: string }>(
      "select full_name, account_state from users where id = $1",
      [user],
    )
    expect(row.rows[0]).toEqual({ full_name: "Renamed Client", account_state: "closed" })
  })
})
