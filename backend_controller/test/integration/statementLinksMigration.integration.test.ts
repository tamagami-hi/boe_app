import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations, type MigrationFile } from "../../src/scripts/migrate.js"

const MIGRATION = "070_client_statement_links"

let container: StartedPostgreSqlContainer
let pool: Pool
let migrations: readonly MigrationFile[]
let before: string
let holder: string

const seedUser = async (state: "active" | "closed", phone: string): Promise<string> => {
  const id = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, closed_at) " +
        "values ($1, $2, 'Upgrade Client', $3::user_account_state, now(), case when $3 = 'closed' then now() end) returning id",
      [`links-${randomUUID()}@example.com`, phone, state],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("user not seeded")
  return id
}

const snapshot = async (): Promise<string> =>
  JSON.stringify(
    (
      await pool.query(
        "select (select json_agg(u order by u.id) from users u) as users, " +
          "(select json_agg(t order by t.id) from password_credential_tokens t) as tokens, " +
          "(select json_agg(c order by c.user_id) from user_credentials c) as credentials",
      )
    ).rows[0],
  )

const insertLink = (values: Readonly<{ userId: string; hash?: Buffer; from?: string; to?: string; expiresAt?: string }>) =>
  pool.query(
    "insert into client_statement_links (user_id, token_hash, token_key_version, from_period, to_period, expires_at, created_at) " +
      "values ($1, $2, 'tk1', $3, $4, $5::timestamptz, '2026-11-14T10:00:00Z')",
    [values.userId, values.hash ?? randomBytes(32), values.from ?? "2026-01", values.to ?? "2026-03", values.expiresAt ?? "2026-11-14T10:10:00Z"],
  )

const refused = async (attempt: Promise<unknown>): Promise<boolean> => {
  try {
    await attempt
    return false
  } catch {
    return true
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 4, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations.filter((migration) => migration.version < MIGRATION))

  holder = await seedUser("active", "+919876520001")
  await seedUser("closed", "+919876520002")
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1, '$argon2id$placeholder')", [holder])
  await pool.query(
    "insert into password_credential_tokens (user_id, purpose, token_hash, token_key_version, expires_at, bound_email_revision, bound_credential_version) " +
      "values ($1, 'reset', $2, 'tk1', now() + interval '10 minutes', 1, 1)",
    [holder, randomBytes(32)],
  )

  before = await snapshot()
  await runMigrations(pool, migrations.filter((migration) => migration.version === MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("statement links populated upgrade", () => {
  test("adds an empty links table and leaves every existing row untouched", async () => {
    expect(await snapshot()).toBe(before)
    expect((await pool.query("select 1 from client_statement_links")).rowCount).toBe(0)
    expect((await pool.query("select version from schema_migrations where version = $1", [MIGRATION])).rowCount).toBe(1)
  })

  test("stores only a 32-byte hash, one link per client, for an ordered month range", async () => {
    const other = await seedUser("active", "+919876520004")
    const hash = randomBytes(32)
    await insertLink({ userId: holder, hash })
    expect(await refused(insertLink({ userId: holder }))).toBe(true)
    expect(await refused(insertLink({ userId: other, hash }))).toBe(true)
    expect(await refused(insertLink({ userId: other, hash: randomBytes(31) }))).toBe(true)
    expect(await refused(insertLink({ userId: other, from: "2026-04", to: "2026-03" }))).toBe(true)
    expect(await refused(insertLink({ userId: other, from: "2026-13", to: "2026-13" }))).toBe(true)
    expect(await refused(insertLink({ userId: other, expiresAt: "2026-11-14T10:00:00Z" }))).toBe(true)
    await insertLink({ userId: other })
    expect((await pool.query("select 1 from client_statement_links")).rowCount).toBe(2)
  })
})
