import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const MIGRATION = "074_optional_payout_reference"
const CHECK_VIOLATION = { code: "23514" }

let container: StartedPostgreSqlContainer
let pool: Pool
let phone = 0
let before: string
let pendingId: string
let paidId: string
let failedId: string

const one = async (text: string, values: readonly unknown[]): Promise<string> => {
  const id = (await pool.query<{ id: string }>(text, [...values])).rows[0]?.id
  if (id === undefined) throw new Error(`no row from ${text.slice(0, 40)}`)
  return id
}

const seedUser = (name: string): Promise<string> => {
  phone += 1
  return one(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) values ($1, $2, $3, 'active', now()) returning id",
    [`payout-${randomUUID()}@example.com`, `+9198767${String(phone).padStart(5, "0")}`, name],
  )
}

const seedFund = async (admin: string): Promise<{ fundId: string; versionId: string }> => {
  const fundId = await one(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`payout-${randomUUID().slice(0, 8)}`, admin],
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

const seedPendingPayout = async (fund: { fundId: string; versionId: string }, admin: string): Promise<string> => {
  const userId = await seedUser("Asha Verma")
  await seedContribution(userId, fund, admin)
  const entryId = await one(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'withdrawal', -100000, -100000, '2025-03-01', 'maturity_withdrawal', 'admin', $3, $4) returning id",
    [userId, fund.fundId, admin, randomUUID()],
  )
  const maturityId = await one(
    "insert into client_position_maturities (user_id, fund_id, state, matured_on, principal_at_maturity_paise, value_at_maturity_paise, " +
      "settlement, settled_at, settlement_entry_id, reason_code, marked_by_user_id, request_id) " +
      "values ($1, $2, 'settled', '2025-03-01', 500000, 500000, 'withdrawal', now(), $3, 'position_matured', $4, $5) returning id",
    [userId, fund.fundId, entryId, admin, randomUUID()],
  )
  return one(
    "insert into withdrawal_operations (user_id, fund_id, maturity_id, ledger_entry_id, amount_paise, growth_portion_paise, " +
      "principal_portion_paise, effective_date, reason_code, created_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, 100000, 0, 100000, '2025-03-01', 'maturity_withdrawal', $5, $6) returning id",
    [userId, fund.fundId, maturityId, entryId, admin, randomUUID()],
  )
}

const payouts = async (): Promise<string> =>
  JSON.stringify((await pool.query("select to_jsonb(w) as row from withdrawal_operations w order by w.id")).rows)

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 4, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  const migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations.filter((migration) => migration.version < MIGRATION))

  const admin = await seedUser("Ops Admin")
  const fund = await seedFund(admin)
  pendingId = await seedPendingPayout(fund, admin)
  paidId = await seedPendingPayout(fund, admin)
  failedId = await seedPendingPayout(fund, admin)
  await pool.query(
    "update withdrawal_operations set state = 'paid', paid_at = now(), transfer_reference = 'BANK-UPGRADE-1', version = 1 where id = $1",
    [paidId],
  )
  await pool.query(
    "update withdrawal_operations set state = 'failed', failed_at = now(), failure_code = 'bank_rejected', version = 1 where id = $1",
    [failedId],
  )
  before = await payouts()

  await runMigrations(pool, migrations.filter((migration) => migration.version >= MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("optional payout reference populated upgrade", () => {
  test("keeps every pending, paid and failed payout exactly as it was", async () => {
    expect(await payouts()).toBe(before)
    expect((await pool.query("select version from schema_migrations where version = $1", [MIGRATION])).rowCount).toBe(1)
  })

  test("lets a paid payout carry no reference and still refuses a blank one or one on a pending or failed payout", async () => {
    await expect(pool.query("update withdrawal_operations set transfer_reference = 'BANK-2' where id = $1", [pendingId])).rejects.toMatchObject(CHECK_VIOLATION)
    await expect(pool.query("update withdrawal_operations set transfer_reference = 'BANK-3' where id = $1", [failedId])).rejects.toMatchObject(CHECK_VIOLATION)
    await expect(pool.query("update withdrawal_operations set transfer_reference = '   ' where id = $1", [paidId])).rejects.toMatchObject(CHECK_VIOLATION)
    await expect(
      pool.query("update withdrawal_operations set state = 'paid', paid_at = null where id = $1", [pendingId]),
    ).rejects.toMatchObject(CHECK_VIOLATION)

    const paidWithout = await pool.query(
      "update withdrawal_operations set state = 'paid', paid_at = now(), version = version + 1 where id = $1 and transfer_reference is null",
      [pendingId],
    )
    expect(paidWithout.rowCount).toBe(1)
    const rows = await pool.query("select id, state, transfer_reference from withdrawal_operations where id = any($1) order by transfer_reference nulls first", [[pendingId, paidId]])
    expect(rows.rows).toEqual([
      { id: pendingId, state: "paid", transfer_reference: null },
      { id: paidId, state: "paid", transfer_reference: "BANK-UPGRADE-1" },
    ])
  })
})
