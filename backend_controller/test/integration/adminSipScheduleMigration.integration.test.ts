import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const MIGRATION = "064_admin_sip_schedules"
const EXISTING_TABLES = ["users", "funds", "fund_versions", "investment_orders", "payments", "investment_allocations", "client_value_entries"]

let container: StartedPostgreSqlContainer
let pool: Pool
let phone = 0

const one = async (text: string, values: readonly unknown[]): Promise<string> => {
  const id = (await pool.query<{ id: string }>(text, [...values])).rows[0]?.id
  if (id === undefined) throw new Error(`no row from ${text.slice(0, 40)}`)
  return id
}

const seedUser = (name: string): Promise<string> => {
  phone += 1
  return one(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) values ($1, $2, $3, 'active', now()) returning id",
    [`sip-${randomUUID()}@example.com`, `+9198765${String(phone).padStart(5, "0")}`, name],
  )
}

const seedFund = async (admin: string): Promise<{ fundId: string; versionId: string }> => {
  const fundId = await one(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`sip-${randomUUID().slice(0, 8)}`, admin],
  )
  const disclosureId = await one(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), admin],
  )
  const versionId = await one(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'Balanced Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4) returning id",
    [fundId, disclosureId, randomBytes(32), admin],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [versionId, fundId])
  return { fundId, versionId }
}

const seedRecording = async (userId: string, fund: { fundId: string; versionId: string }, admin: string): Promise<string> => {
  const orderId = await one(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'recorded_offline', 'accepted', 500000, now()) returning id",
    [userId, fund.fundId, fund.versionId],
  )
  const paymentId = await one(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, 500000, 'succeeded', now()) returning id",
    [orderId, userId],
  )
  const allocationId = await one(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, 500000, $4, $5) returning id",
    [orderId, userId, fund.fundId, admin, randomUUID()],
  )
  return one(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', 500000, 500000, '2025-02-03', $4, $5, 'recorded_offline_monthly_investment', 'admin', $6, $7) returning id",
    [userId, fund.fundId, allocationId, orderId, paymentId, admin, randomUUID()],
  )
}

const snapshot = async (): Promise<string> => {
  const parts: string[] = []
  for (const table of EXISTING_TABLES) {
    const rows = await pool.query<{ row: unknown }>(`select to_jsonb(t) as row from ${table} t order by t.id`)
    parts.push(JSON.stringify(rows.rows))
  }
  return parts.join("\n")
}

const link = (scheduleId: string, userId: string, fundId: string, month: string, entryId: string, admin: string) =>
  pool.query(
    "insert into admin_sip_schedule_months (schedule_id, user_id, fund_id, sip_month, entry_id, created_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, $5, $6, $7) returning id",
    [scheduleId, userId, fundId, month, entryId, admin, randomUUID()],
  )

let admin: string
let client: string
let stranger: string
let fund: { fundId: string; versionId: string }
let entries: string[]
let strangerEntry: string
let before: string

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 4, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  const migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations.filter((migration) => migration.version < MIGRATION))

  admin = await seedUser("Ops Admin")
  client = await seedUser("Asha Verma")
  stranger = await seedUser("Ravi Menon")
  fund = await seedFund(admin)
  entries = [await seedRecording(client, fund, admin), await seedRecording(client, fund, admin)]
  strangerEntry = await seedRecording(stranger, fund, admin)
  before = await snapshot()

  await runMigrations(pool, migrations.filter((migration) => migration.version >= MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("admin SIP schedule populated upgrade", () => {
  test("keeps every existing client, fund and ledger row unchanged and starts both tables empty", async () => {
    expect(await snapshot()).toBe(before)
    expect((await pool.query("select count(*)::int as c from admin_sip_schedules")).rows[0]).toEqual({ c: 0 })
    expect((await pool.query("select count(*)::int as c from admin_sip_schedule_months")).rows[0]).toEqual({ c: 0 })
  })

  test("holds each month to one live recording of the same client and fund inside the schedule's range", async () => {
    const scheduleId = await one(
      "insert into admin_sip_schedules (user_id, fund_id, monthly_amount_paise, start_month, month_count, created_by_user_id, updated_by_user_id, request_id) " +
        "values ($1, $2, 500000, '2025-01-01', 3, $3, $3, $4) returning id",
      [client, fund.fundId, admin, randomUUID()],
    )
    const [firstEntry, secondEntry] = entries as [string, string]

    await expect(link(scheduleId, client, fund.fundId, "2025-04-01", firstEntry, admin)).rejects.toThrow(/outside schedule/u)
    await link(scheduleId, client, fund.fundId, "2025-02-01", firstEntry, admin)
    await expect(link(scheduleId, client, fund.fundId, "2025-02-01", secondEntry, admin)).rejects.toThrow(/admin_sip_schedule_months_live_uk/u)
    await expect(link(scheduleId, client, fund.fundId, "2025-03-01", firstEntry, admin)).rejects.toThrow(/admin_sip_schedule_months_entry_uk/u)
    await expect(link(scheduleId, stranger, fund.fundId, "2025-03-01", strangerEntry, admin)).rejects.toThrow(/admin_sip_schedule_months_schedule_fk/u)
    await expect(link(scheduleId, client, fund.fundId, "2025-03-01", strangerEntry, admin)).rejects.toThrow(/admin_sip_schedule_months_entry_fk/u)
    await expect(pool.query("update admin_sip_schedules set month_count = 1 where id = $1", [scheduleId])).rejects.toThrow(/linked months/u)
    await expect(pool.query("delete from admin_sip_schedule_months where schedule_id = $1", [scheduleId])).rejects.toThrow(/append-only/u)
    await expect(
      pool.query("update admin_sip_schedule_months set released_at = now() where schedule_id = $1", [scheduleId]),
    ).rejects.toThrow(/released only after its recording is reversed/u)
    await expect(
      pool.query(
        "insert into admin_sip_schedules (user_id, fund_id, monthly_amount_paise, start_month, month_count, created_by_user_id, updated_by_user_id, request_id) " +
          "values ($1, $2, 100, '2025-05-01', 2, $3, $3, $4)",
        [client, fund.fundId, admin, randomUUID()],
      ),
    ).rejects.toThrow(/admin_sip_schedules_active_uk/u)
  })
})
