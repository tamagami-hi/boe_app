import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const MIGRATION = "068_maturity_choices"
const EXISTING_TABLES = [
  "users",
  "client_value_entries",
  "client_position_maturities",
  "withdrawal_operations",
  "admin_sip_schedules",
  "client_maturity_schedules",
  "audit_events",
]

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
    [`choices-${randomUUID()}@example.com`, `+9198767${String(phone).padStart(5, "0")}`, name],
  )
}

const seedFund = async (admin: string): Promise<string> => {
  const fundId = await one(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`choices-${randomUUID().slice(0, 8)}`, admin],
  )
  const disclosureId = await one(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), admin],
  )
  const versionId = await one(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'Choices Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4) returning id",
    [fundId, disclosureId, randomBytes(32), admin],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [versionId, fundId])
  return fundId
}

const seedWithdrawal = async (userId: string, fundId: string, admin: string): Promise<string> => {
  const entryId = await one(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'withdrawal', -100000, -100000, '2025-03-01', 'maturity_withdrawal', 'admin', $3, $4) returning id",
    [userId, fundId, admin, randomUUID()],
  )
  const maturityId = await one(
    "insert into client_position_maturities (user_id, fund_id, state, matured_on, principal_at_maturity_paise, value_at_maturity_paise, " +
      "settlement, settled_at, settlement_entry_id, reason_code, marked_by_user_id, request_id) " +
      "values ($1, $2, 'settled', '2025-03-01', 100000, 100000, 'withdrawal', now(), $3, 'position_matured', $4, $5) returning id",
    [userId, fundId, entryId, admin, randomUUID()],
  )
  await pool.query(
    "insert into withdrawal_operations (user_id, fund_id, maturity_id, ledger_entry_id, amount_paise, growth_portion_paise, " +
      "principal_portion_paise, effective_date, reason_code, created_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, 100000, 0, 100000, '2025-03-01', 'maturity_withdrawal', $5, $6)",
    [userId, fundId, maturityId, entryId, admin, randomUUID()],
  )
  return maturityId
}

const seedSip = (userId: string, fundId: string, admin: string): Promise<string> =>
  one(
    "insert into admin_sip_schedules (user_id, fund_id, monthly_amount_paise, start_month, month_count, created_by_user_id, updated_by_user_id, request_id) " +
      "values ($1, $2, 500000, '2025-04-01', 12, $3, $3, $4) returning id",
    [userId, fundId, admin, randomUUID()],
  )

const insertRow = (table: string, values: Readonly<Record<string, unknown>>) => {
  const columns = Object.keys(values)
  const placeholders = columns.map((_, index) => `$${String(index + 1)}`)
  return pool.query<{ id: string }>(
    `insert into ${table} (${columns.join(", ")}) values (${placeholders.join(", ")}) returning id`,
    Object.values(values),
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

let admin: string
let client: string
let stranger: string
let fundId: string
let clientSip: string
let openSchedule: string
let strangerSchedule: string
let before: string

const seedSchedules = async (): Promise<void> => {
  const base = { user_id: client, fund_id: fundId, created_by_user_id: admin, updated_by_user_id: admin }
  const maturityId = await seedWithdrawal(client, fundId, admin)
  await insertRow("client_maturity_schedules", {
    ...base,
    maturity_date: "2025-03-01",
    state: "resolved",
    resolution: "return_all",
    maturity_id: maturityId,
    resolved_at: new Date(),
    request_id: randomUUID(),
  })
  await insertRow("client_maturity_schedules", {
    ...base,
    maturity_date: "2025-06-30",
    state: "resolved",
    resolution: "sip_reinvestment",
    follow_up_sip_schedule_id: clientSip,
    resolved_at: new Date(),
    request_id: randomUUID(),
  })
  await insertRow("client_maturity_schedules", {
    ...base,
    maturity_date: "2025-09-30",
    state: "cancelled",
    cancelled_at: new Date(),
    request_id: randomUUID(),
  })
  openSchedule = (await insertRow("client_maturity_schedules", { ...base, maturity_date: "2026-01-31", request_id: randomUUID() })).rows[0]!.id
  strangerSchedule = (
    await insertRow("client_maturity_schedules", {
      ...base,
      user_id: stranger,
      maturity_date: "2026-01-31",
      request_id: randomUUID(),
    })
  ).rows[0]!.id
  await pool.query(
    "insert into audit_events (actor_type, actor_user_id, command, entity_type, entity_id, to_state, request_id, entity_version, metadata) " +
      "values ('admin', $1, 'client_maturity_schedule.created', 'client_maturity_schedule', $2, 'scheduled', $3, 1, $4)",
    [admin, openSchedule, randomUUID(), JSON.stringify({ userId: client, fundId })],
  )
}

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
  fundId = await seedFund(admin)
  clientSip = await seedSip(client, fundId, admin)
  await seedSchedules()
  before = await snapshot()

  await runMigrations(pool, migrations.filter((migration) => migration.version >= MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

const offerBase = () => ({
  maturity_schedule_id: openSchedule,
  user_id: client,
  fund_id: fundId,
  sip_monthly_amount_paise: 300000,
  sip_start_month: "2026-02-01",
  sip_month_count: 24,
  created_by_user_id: admin,
  request_id: randomUUID(),
})

describe("maturity choices populated upgrade", () => {
  test("keeps every client, ledger, payout, SIP, maturity and audit row unchanged and starts with no offers", async () => {
    expect(await snapshot()).toBe(before)
    expect((await pool.query("select count(*)::int as c from client_maturity_offers")).rows[0]).toEqual({ c: 0 })
    expect((await pool.query("select resolution from client_maturity_schedules where resolution = 'sip_reinvestment'")).rowCount).toBe(1)
  })

  test("accepts an extension resolution linked to the extended SIP and still refuses a broken link", async () => {
    const base = { user_id: client, fund_id: fundId, created_by_user_id: admin, updated_by_user_id: admin, maturity_date: "2024-12-31" }
    await expect(
      insertRow("client_maturity_schedules", { ...base, state: "resolved", resolution: "sip_extension", resolved_at: new Date(), request_id: randomUUID() }),
    ).rejects.toThrow(/client_maturity_schedules_resolution_links/u)
    await expect(
      insertRow("client_maturity_schedules", { ...base, state: "resolved", resolution: "sip_rollover", resolved_at: new Date(), request_id: randomUUID() }),
    ).rejects.toThrow(/client_maturity_schedules_resolution/u)
    const extended = await insertRow("client_maturity_schedules", {
      ...base,
      state: "resolved",
      resolution: "sip_extension",
      follow_up_sip_schedule_id: clientSip,
      resolved_at: new Date(),
      request_id: randomUUID(),
    })
    expect(extended.rowCount).toBe(1)
  })

  test("holds one open offer per maturity for the same client and fund, keeps figures fixed and never rewrites a closed offer", async () => {
    await expect(insertRow("client_maturity_offers", { ...offerBase(), user_id: stranger })).rejects.toThrow(/client_maturity_offers_schedule_fk/u)
    await expect(insertRow("client_maturity_offers", { ...offerBase(), extension_months: 12 })).rejects.toThrow(/client_maturity_offers_extension/u)
    await expect(insertRow("client_maturity_offers", { ...offerBase(), next_maturity_date: "2027-01-31" })).rejects.toThrow(
      /client_maturity_offers_extension/u,
    )
    await expect(insertRow("client_maturity_offers", { ...offerBase(), sip_start_month: "2026-02-15" })).rejects.toThrow(/client_maturity_offers_sip_start/u)
    await expect(
      insertRow("client_maturity_offers", { ...offerBase(), chosen_option: "sip_extension", chosen_at: new Date() }),
    ).rejects.toThrow(/client_maturity_offers_extension_choice/u)
    await expect(insertRow("client_maturity_offers", { ...offerBase(), state: "withdrawn" })).rejects.toThrow(/client_maturity_offers_shape/u)

    const first = (await insertRow("client_maturity_offers", { ...offerBase(), extension_months: 12, next_maturity_date: "2027-01-31" })).rows[0]!.id
    await expect(insertRow("client_maturity_offers", offerBase())).rejects.toThrow(/client_maturity_offers_open_uk/u)
    await expect(insertRow("client_maturity_offers", { ...offerBase(), maturity_schedule_id: strangerSchedule })).rejects.toThrow(
      /client_maturity_offers_schedule_fk/u,
    )

    await pool.query("update client_maturity_offers set chosen_option = 'sip_extension', chosen_at = now(), version = 2 where id = $1", [first])
    await expect(pool.query("update client_maturity_offers set sip_month_count = 36 where id = $1", [first])).rejects.toThrow(/figures never change/u)
    await pool.query(
      "update client_maturity_offers set state = 'confirmed', closed_at = now(), closed_by_user_id = $2, version = 3 where id = $1",
      [first, admin],
    )
    await expect(pool.query("update client_maturity_offers set chosen_option = 'return_all' where id = $1", [first])).rejects.toThrow(
      /closed row never changes/u,
    )
    await expect(pool.query("delete from client_maturity_offers where id = $1", [first])).rejects.toThrow(/never deleted/u)
    await expect(pool.query("truncate client_maturity_offers")).rejects.toThrow(/never deleted/u)
    expect((await insertRow("client_maturity_offers", offerBase())).rowCount).toBe(1)
  })
})
