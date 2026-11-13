import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const MIGRATION = "065_client_maturity_schedules"
const EXISTING_TABLES = [
  "users",
  "funds",
  "fund_versions",
  "investment_orders",
  "payments",
  "investment_allocations",
  "client_value_entries",
  "client_position_maturities",
  "withdrawal_operations",
  "admin_sip_schedules",
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
    [`maturity-${randomUUID()}@example.com`, `+9198766${String(phone).padStart(5, "0")}`, name],
  )
}

const seedFund = async (admin: string): Promise<{ fundId: string; versionId: string }> => {
  const fundId = await one(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`maturity-${randomUUID().slice(0, 8)}`, admin],
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

const seedContribution = async (userId: string, fund: { fundId: string; versionId: string }, admin: string): Promise<void> => {
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
  await pool.query(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', 500000, 500000, '2025-02-03', $4, $5, 'recorded_offline_investment', 'admin', $6, $7)",
    [userId, fund.fundId, allocationId, orderId, paymentId, admin, randomUUID()],
  )
}

const seedSettledWithdrawal = async (userId: string, fundId: string, admin: string): Promise<string> => {
  const entryId = await one(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'withdrawal', -100000, -100000, '2025-03-01', 'maturity_withdrawal', 'admin', $3, $4) returning id",
    [userId, fundId, admin, randomUUID()],
  )
  const maturityId = await one(
    "insert into client_position_maturities (user_id, fund_id, state, matured_on, principal_at_maturity_paise, value_at_maturity_paise, " +
      "settlement, settled_at, settlement_entry_id, reason_code, marked_by_user_id, request_id) " +
      "values ($1, $2, 'settled', '2025-03-01', 500000, 500000, 'withdrawal', now(), $3, 'position_matured', $4, $5) returning id",
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

const snapshot = async (): Promise<string> => {
  const parts: string[] = []
  for (const table of EXISTING_TABLES) {
    const rows = await pool.query<{ row: unknown }>(`select to_jsonb(t) as row from ${table} t order by t.id`)
    parts.push(JSON.stringify(rows.rows))
  }
  return parts.join("\n")
}

const insertSchedule = (values: Readonly<Record<string, unknown>>) => {
  const columns = Object.keys(values)
  const placeholders = columns.map((_, index) => `$${String(index + 1)}`)
  return pool.query<{ id: string }>(
    `insert into client_maturity_schedules (${columns.join(", ")}) values (${placeholders.join(", ")}) returning id`,
    Object.values(values),
  )
}

let admin: string
let client: string
let stranger: string
let fund: { fundId: string; versionId: string }
let clientMaturity: string
let strangerMaturity: string
let clientSip: string
let strangerSip: string
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
  await seedContribution(client, fund, admin)
  await seedContribution(stranger, fund, admin)
  clientMaturity = await seedSettledWithdrawal(client, fund.fundId, admin)
  strangerMaturity = await seedSettledWithdrawal(stranger, fund.fundId, admin)
  clientSip = await seedSip(client, fund.fundId, admin)
  strangerSip = await seedSip(stranger, fund.fundId, admin)
  before = await snapshot()

  await runMigrations(pool, migrations.filter((migration) => migration.version >= MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("client maturity schedule populated upgrade", () => {
  test("keeps every client, ledger, maturity, payout and SIP row unchanged and starts empty", async () => {
    expect(await snapshot()).toBe(before)
    expect((await pool.query("select count(*)::int as c from client_maturity_schedules")).rows[0]).toEqual({ c: 0 })
  })

  test("holds one open date per holding, ties links to the same client and fund, and never rewrites a closed row", async () => {
    const base = { user_id: client, fund_id: fund.fundId, created_by_user_id: admin, updated_by_user_id: admin }
    const open = (await insertSchedule({ ...base, maturity_date: "2030-06-30", request_id: randomUUID() })).rows[0]!.id
    await expect(insertSchedule({ ...base, maturity_date: "2031-06-30", request_id: randomUUID() })).rejects.toThrow(/client_maturity_schedules_open_uk/u)
    await expect(insertSchedule({ ...base, maturity_date: "1999-12-31", request_id: randomUUID() })).rejects.toThrow(/client_maturity_schedules_date/u)
    await expect(
      insertSchedule({ ...base, maturity_date: "2030-06-30", state: "resolved", resolved_at: new Date(), request_id: randomUUID() }),
    ).rejects.toThrow(/client_maturity_schedules_shape/u)
    await expect(
      insertSchedule({
        ...base,
        maturity_date: "2025-03-01",
        state: "resolved",
        resolution: "return_all",
        resolved_at: new Date(),
        maturity_id: strangerMaturity,
        request_id: randomUUID(),
      }),
    ).rejects.toThrow(/client_maturity_schedules_maturity_fk/u)
    await expect(
      insertSchedule({
        ...base,
        maturity_date: "2025-03-01",
        state: "resolved",
        resolution: "sip_reinvestment",
        resolved_at: new Date(),
        follow_up_sip_schedule_id: strangerSip,
        request_id: randomUUID(),
      }),
    ).rejects.toThrow(/client_maturity_schedules_sip_schedule_fk/u)
    await expect(
      insertSchedule({
        ...base,
        maturity_date: "2025-03-01",
        state: "resolved",
        resolution: "return_all",
        resolved_at: new Date(),
        maturity_id: clientMaturity,
        follow_up_sip_schedule_id: clientSip,
        request_id: randomUUID(),
      }),
    ).rejects.toThrow(/client_maturity_schedules_resolution_links/u)

    await pool.query(
      "update client_maturity_schedules set state = 'resolved', resolution = 'return_all', maturity_id = $2, resolved_at = now(), version = 2 where id = $1",
      [open, clientMaturity],
    )
    await expect(pool.query("update client_maturity_schedules set maturity_date = '2031-01-01' where id = $1", [open])).rejects.toThrow(/never changes/u)
    await expect(pool.query("delete from client_maturity_schedules where id = $1", [open])).rejects.toThrow(/never deleted/u)
    await expect(pool.query("truncate client_maturity_schedules, client_maturity_offers")).rejects.toThrow(
      /client_maturity_schedules rows are never deleted/u,
    )
    await expect(
      insertSchedule({ ...base, maturity_date: "2032-01-01", state: "resolved", resolution: "return_all", resolved_at: new Date(), maturity_id: clientMaturity, request_id: randomUUID() }),
    ).rejects.toThrow(/client_maturity_schedules_maturity_uk/u)
    expect((await insertSchedule({ ...base, maturity_date: "2032-01-01", request_id: randomUUID() })).rowCount).toBe(1)
  })
})
