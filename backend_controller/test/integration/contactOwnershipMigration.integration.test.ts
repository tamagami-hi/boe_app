import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const OWNERSHIP_MIGRATION = "056_contact_ownership"
const OWNERSHIP_MIGRATION_FILE = "056_contact_ownership.sql"

type Row = Record<string, unknown>

let container: StartedPostgreSqlContainer
let pool: Pool
let phoneCounter = 0

const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415556${String(phoneCounter).padStart(4, "0")}`
}

const nextEmail = (label: string): string => `${label}-${randomUUID()}@example.com`

const insertApplication = async (
  state: "submitted" | "approved" | "rejected" | "withdrawn",
  email: string,
  phone: string,
): Promise<string> => {
  const decided = state === "submitted" ? null : new Date(Date.now() - 86_400_000)
  const id = (
    await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
        "values ($1, $2, 'Asha Verma', $3::application_state, now() - interval '2 days', $4) returning id",
      [email, phone, state, decided],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("application not created")
  return id
}

const insertUser = async (email: string, phone: string, applicationId: string | null): Promise<string> => {
  const id = (
    await pool.query<{ id: string }>(
      "insert into users (application_id, email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, $3, 'Asha Verma', 'active', now()) returning id",
      [applicationId, email, phone],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("user not created")
  return id
}

const snapshot = async (): Promise<{ applications: Row[]; users: Row[] }> => ({
  applications: (await pool.query<Row>("select * from applications order by id")).rows,
  users: (await pool.query<Row>("select * from users order by id")).rows,
})

const indexes = async (): Promise<Row[]> =>
  (
    await pool.query<Row>(
      "select indexname, indexdef from pg_indexes where tablename = 'applications' and indexdef ilike '%unique%' order by indexname",
    )
  ).rows

const insertSubmitted = (email: string, phone: string): Promise<unknown> =>
  pool.query(
    "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at) " +
      "values ($1, $2, 'New Applicant', 'submitted', now())",
    [email, phone],
  )

const fixture = {
  heldEmail: nextEmail("held"),
  heldPhone: nextPhone(),
  releasedEmail: nextEmail("released"),
  releasedPhone: nextPhone(),
  pendingEmail: nextEmail("pending"),
  pendingPhone: nextPhone(),
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({
    connectionString: container.getConnectionUri(),
    poolMax: 4,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
  })
  const migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations.filter((migration) => migration.version < OWNERSHIP_MIGRATION))

  const held = await insertApplication("approved", fixture.heldEmail, fixture.heldPhone)
  await insertUser(fixture.heldEmail, fixture.heldPhone, held)

  const released = await insertApplication("approved", fixture.releasedEmail, fixture.releasedPhone)
  await insertUser(nextEmail("moved"), nextPhone(), released)

  await insertApplication("submitted", fixture.pendingEmail, fixture.pendingPhone)
  await insertApplication("rejected", nextEmail("rejected"), nextPhone())
  await insertApplication("withdrawn", nextEmail("withdrawn"), nextPhone())
  await insertUser(nextEmail("admin-created"), nextPhone(), null)
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("migration 056 narrows application uniqueness to submitted applications", () => {
  test("before it, an approved application keeps a contact its user has replaced reserved forever", async () => {
    await expect(insertSubmitted(nextEmail("blocked"), fixture.releasedPhone)).rejects.toThrow(/applications_active_phone_uk/u)
    await expect(insertSubmitted(fixture.releasedEmail, nextPhone())).rejects.toThrow(/applications_active_email_uk/u)
  })

  test("changes only the two indexes and the template check, and leaves every row as recorded", async () => {
    const before = await snapshot()
    const indexesBefore = await indexes()

    const applied = await runMigrations(
      pool,
      (await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))).filter(
        (migration) => migration.version === OWNERSHIP_MIGRATION,
      ),
    )

    expect(applied).toEqual([OWNERSHIP_MIGRATION_FILE])
    expect(await snapshot()).toEqual(before)
    const names = (await indexes()).map((index) => index.indexname)
    expect(names).toContain("applications_submitted_email_uk")
    expect(names).toContain("applications_submitted_phone_uk")
    expect(names).not.toContain("applications_active_email_uk")
    expect(names).not.toContain("applications_active_phone_uk")
    expect(indexesBefore.map((index) => index.indexname)).toContain("applications_active_phone_uk")
  })

  test("after it, a contact released by a user who changed it can be applied with again", async () => {
    await expect(insertSubmitted(nextEmail("reuse"), fixture.releasedPhone)).resolves.toBeDefined()
    await expect(insertSubmitted(fixture.releasedEmail, nextPhone())).resolves.toBeDefined()
  })

  test("still refuses a second submitted application with the same email or phone", async () => {
    await expect(insertSubmitted(fixture.pendingEmail, nextPhone())).rejects.toThrow(/applications_submitted_email_uk/u)
    await expect(insertSubmitted(nextEmail("dup"), fixture.pendingPhone)).rejects.toThrow(/applications_submitted_phone_uk/u)
  })

  test("still refuses a second user with the same email or phone", async () => {
    await expect(insertUser(fixture.heldEmail, nextPhone(), null)).rejects.toThrow(/users_email_uk/u)
    await expect(insertUser(nextEmail("dup-user"), fixture.heldPhone, null)).rejects.toThrow(/users_phone_uk/u)
  })

  test("accepts the phone-change notice template key", async () => {
    const check = (
      await pool.query<{ definition: string }>(
        "select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'email_deliveries_template_check'",
      )
    ).rows[0]?.definition
    expect(check).toContain("contact_phone_changed")
    expect(check).toContain("password_set_link")
  })
})
