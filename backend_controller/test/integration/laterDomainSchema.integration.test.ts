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
let userId: string

const seedUser = async (): Promise<string> => {
  const row = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Catalog Admin', 'active', now()) returning id",
    [`admin-${randomUUID()}@example.com`, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
  )
  return row.rows[0]?.id as string
}

// A minimal fund row is enough to satisfy fund_id foreign keys on orders,
// executions, holdings, and lots (the full publish chain is exercised above).
const createFund = async (creator: string): Promise<string> => {
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, created_by_user_id) values ($1, $2) returning id",
    [`fund-${randomUUID().slice(0, 8)}`, creator],
  )
  return fund.rows[0]?.id as string
}

// Returns the version of the single active finance policy, creating one if the
// suite has not already (only one active row is permitted at a time).
const activeFinancePolicyVersion = async (): Promise<number> => {
  const existing = await pool.query<{ version: number }>(
    "select version from finance_policy_versions where retired_at is null order by version desc limit 1",
  )
  if (existing.rows[0]) return existing.rows[0].version
  const inserted = await pool.query<{ version: number }>(
    "insert into finance_policy_versions (version, effective_from, published_by_user_id) values (1, now(), $1) returning version",
    [userId],
  )
  return inserted.rows[0]?.version as number
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
  // Applying the full canonical baseline (>= 009), including the later-domain
  // migrations 014-016, is itself the primary assertion that the DDL is valid.
  await runMigrations(
    pool,
    all.filter((file) => file.version >= "009"),
  )
  userId = await seedUser()
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("later-domain schema (integration)", () => {
  test("compliance: one open KYC case per user is enforced", async () => {
    await pool.query("insert into kyc_cases (user_id, state) values ($1, 'submitted')", [userId])
    await expect(
      pool.query("insert into kyc_cases (user_id, state) values ($1, 'in_review')", [userId]),
    ).rejects.toThrow()
    // A terminal case does not count against the open-case uniqueness.
    await pool.query("insert into kyc_cases (user_id, state) values ($1, 'approved')", [userId])
  })

  test("compliance: an assessed risk assessment requires score, category, and timestamp", async () => {
    const other = await seedUser()
    await expect(
      pool.query(
        "insert into risk_assessments (user_id, state, questionnaire_version) values ($1, 'assessed', 'v1')",
        [other],
      ),
    ).rejects.toThrow()
    await pool.query(
      "insert into risk_assessments (user_id, state, questionnaire_version, score, category, assessed_at) " +
        "values ($1, 'assessed', 'v1', 60, 'balanced', now())",
      [other],
    )
  })

  test("catalog: a fund version links disclosure + NAV of the same fund and sets the current pointer", async () => {
    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, created_by_user_id) values ($1, $2) returning id",
      [`fund-${randomUUID().slice(0, 8)}`, userId],
    )
    const fundId = fund.rows[0]?.id as string
    const disclosure = await pool.query<{ id: string }>(
      "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
        "values ($1, 1, 'Disclosure', 'body', $2, now(), $3) returning id",
      [fundId, Buffer.alloc(32), userId],
    )
    const nav = await pool.query<{ id: string }>(
      "insert into fund_nav_prices (fund_id, nav, as_of_date, published_by_user_id) values ($1, 10.5, current_date, $2) returning id",
      [fundId, userId],
    )
    const fundVersion = await pool.query<{ id: string }>(
      "insert into fund_versions (fund_id, version, name, category, objective, risk_level, minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, initial_nav_price_id, terms_sha256, created_by_user_id) " +
        "values ($1, 1, 'Growth Fund', 'equity', 'grow', 'high', 50000, 100000, $2, $3, $4, $5) returning id",
      [fundId, disclosure.rows[0]?.id, nav.rows[0]?.id, Buffer.alloc(32), userId],
    )
    await pool.query(
      "update funds set state = 'published', current_published_version_id = $2, published_at = now() where id = $1",
      [fundId, fundVersion.rows[0]?.id],
    )
    const stored = await pool.query("select state from funds where id = $1", [fundId])
    expect(stored.rows[0]).toMatchObject({ state: "published" })
  })

  test("catalog: a fund version cannot link a disclosure from a different fund", async () => {
    const fundA = await pool.query<{ id: string }>(
      "insert into funds (slug, created_by_user_id) values ($1, $2) returning id",
      [`fund-${randomUUID().slice(0, 8)}`, userId],
    )
    const fundB = await pool.query<{ id: string }>(
      "insert into funds (slug, created_by_user_id) values ($1, $2) returning id",
      [`fund-${randomUUID().slice(0, 8)}`, userId],
    )
    const disclosureB = await pool.query<{ id: string }>(
      "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
        "values ($1, 1, 'D', 'b', $2, now(), $3) returning id",
      [fundB.rows[0]?.id, Buffer.alloc(32), userId],
    )
    const navA = await pool.query<{ id: string }>(
      "insert into fund_nav_prices (fund_id, nav, as_of_date, published_by_user_id) values ($1, 10, current_date, $2) returning id",
      [fundA.rows[0]?.id, userId],
    )
    await expect(
      pool.query(
        "insert into fund_versions (fund_id, version, name, category, objective, risk_level, minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, initial_nav_price_id, terms_sha256, created_by_user_id) " +
          "values ($1, 1, 'X', 'equity', 'o', 'low', 0, 0, $2, $3, $4, $5)",
        [fundA.rows[0]?.id, disclosureB.rows[0]?.id, navA.rows[0]?.id, Buffer.alloc(32), userId],
      ),
    ).rejects.toThrow()
  })

  test("platform: exactly one active finance policy version is allowed", async () => {
    await pool.query(
      "insert into finance_policy_versions (version, effective_from, published_by_user_id) values (1, now(), $1)",
      [userId],
    )
    await expect(
      pool.query(
        "insert into finance_policy_versions (version, effective_from, published_by_user_id) values (2, now(), $1)",
        [userId],
      ),
    ).rejects.toThrow()
  })

  test("platform: one published content item per key", async () => {
    const key = `faq-${randomUUID().slice(0, 8)}`
    await pool.query(
      "insert into content_items (content_key, kind, version, title, body, state, published_at, published_by_user_id) " +
        "values ($1, 'faq', 1, 'Q', 'A', 'published', now(), $2)",
      [key, userId],
    )
    await expect(
      pool.query(
        "insert into content_items (content_key, kind, version, title, body, state, published_at, published_by_user_id) " +
          "values ($1, 'faq', 2, 'Q2', 'A2', 'published', now(), $2)",
        [key, userId],
      ),
    ).rejects.toThrow()
  })

  test("money core: mandate -> sip -> order -> execution -> holding/lot/movement and order -> payment -> attempt", async () => {
    const owner = await seedUser()
    const fund = await createFund(owner)

    const mandate = await pool.query<{ id: string }>(
      "insert into mandates (user_id, provider, max_amount_paise, frequency, debit_day, state) " +
        "values ($1, 'acme-pay', 500000, 'monthly', 5, 'active') returning id",
      [owner],
    )
    const mandateId = mandate.rows[0]?.id as string

    const sip = await pool.query<{ id: string }>(
      "insert into sip_plans (user_id, fund_id, amount_paise, debit_day, state, mandate_id) " +
        "values ($1, $2, 500000, 5, 'active', $3) returning id",
      [owner, fund, mandateId],
    )
    const sipId = sip.rows[0]?.id as string

    const order = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, sip_plan_id, type, state, amount_paise) " +
        "values ($1, $2, $3, 'sip_installment', 'payment_confirmed', 500000) returning id",
      [owner, fund, sipId],
    )
    const orderId = order.rows[0]?.id as string

    // A payment for the order, then a provider attempt against it.
    const payment = await pool.query<{ id: string }>(
      "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) " +
        "values ($1, $2, 500000, 'succeeded', now()) returning id",
      [orderId, owner],
    )
    const paymentId = payment.rows[0]?.id as string
    await pool.query(
      "insert into payment_attempts (payment_id, user_id, attempt_number, provider, provider_payment_id, state) " +
        "values ($1, $2, 1, 'acme-pay', $3, 'succeeded')",
      [paymentId, owner, `pp-${randomUUID().slice(0, 12)}`],
    )

    // Booked allotment execution (positive NAV + units).
    const execution = await pool.query<{ id: string }>(
      "insert into investment_executions (order_id, user_id, fund_id, type, amount_paise, nav, units, executed_at) " +
        "values ($1, $2, $3, 'allotment', 500000, 10.50000000, 476.19047619, now()) returning id",
      [orderId, owner, fund],
    )
    const executionId = execution.rows[0]?.id as string

    // Ownership: holding, then a lot sourced from the execution, then a movement.
    const holding = await pool.query<{ id: string }>(
      "insert into holdings (user_id, fund_id, total_units, cost_basis_paise) " +
        "values ($1, $2, 476.19047619, 500000) returning id",
      [owner, fund],
    )
    const holdingId = holding.rows[0]?.id as string
    const lot = await pool.query<{ id: string }>(
      "insert into holding_lots (holding_id, user_id, fund_id, source_execution_id, acquired_on, cost_basis_paise, original_units, remaining_units) " +
        "values ($1, $2, $3, $4, current_date, 500000, 476.19047619, 476.19047619) returning id",
      [holdingId, owner, fund, executionId],
    )
    const lotId = lot.rows[0]?.id as string
    await pool.query(
      "insert into holding_lot_movements (holding_lot_id, holding_id, user_id, fund_id, execution_id, movement_type, units_delta, cost_basis_delta_paise) " +
        "values ($1, $2, $3, $4, $5, 'allotment', 476.19047619, 500000)",
      [lotId, holdingId, owner, fund, executionId],
    )

    const movements = await pool.query<{ count: string }>(
      "select count(*)::text as count from holding_lot_movements where holding_lot_id = $1",
      [lotId],
    )
    expect(movements.rows[0]?.count).toBe("1")
  })

  test("ownership: a payment cannot reference an order that belongs to a different user (composite FK)", async () => {
    const owner = await seedUser()
    const intruder = await seedUser()
    const fund = await createFund(owner)
    const order = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, type, state, amount_paise) " +
        "values ($1, $2, 'purchase', 'submitted', 100000) returning id",
      [owner, fund],
    )
    // Same order id, but a different user_id, must be rejected by (order_id, user_id).
    await expect(
      pool.query(
        "insert into payments (order_id, user_id, amount_paise, state) values ($1, $2, 100000, 'created')",
        [order.rows[0]?.id, intruder],
      ),
    ).rejects.toThrow()
  })

  test("executions: at most one non-reversal booking per order", async () => {
    const owner = await seedUser()
    const fund = await createFund(owner)
    const order = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, type, state, amount_paise) " +
        "values ($1, $2, 'purchase', 'booked', 200000) returning id",
      [owner, fund],
    )
    const orderId = order.rows[0]?.id as string
    await pool.query(
      "insert into investment_executions (order_id, user_id, fund_id, type, amount_paise, nav, units) " +
        "values ($1, $2, $3, 'allotment', 200000, 10, 200) ",
      [orderId, owner, fund],
    )
    await expect(
      pool.query(
        "insert into investment_executions (order_id, user_id, fund_id, type, amount_paise, nav, units) " +
          "values ($1, $2, $3, 'allotment', 200000, 10, 200)",
        [orderId, owner, fund],
      ),
    ).rejects.toThrow()
  })

  test("orders: a non-redemption order may not carry requested units", async () => {
    const owner = await seedUser()
    const fund = await createFund(owner)
    await expect(
      pool.query(
        "insert into investment_orders (user_id, fund_id, type, state, amount_paise, requested_units) " +
          "values ($1, $2, 'purchase', 'submitted', 100000, 5)",
        [owner, fund],
      ),
    ).rejects.toThrow()
  })

  test("payments: an invalid provider-event signature is rejected at the boundary", async () => {
    await expect(
      pool.query(
        "insert into provider_events (provider, provider_event_id, event_type, signature_valid, payload_ciphertext, payload_nonce, payload_key_version, payload_sha256) " +
          "values ('acme-pay', $1, 'payment.succeeded', false, $2, $3, 'v1', $4)",
        [`evt-${randomUUID().slice(0, 12)}`, Buffer.alloc(32), Buffer.alloc(12), Buffer.alloc(32)],
      ),
    ).rejects.toThrow()
  })

  test("redemption: reserved units cannot exceed requested units", async () => {
    const owner = await seedUser()
    const fund = await createFund(owner)
    const order = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, type, state, requested_units) " +
        "values ($1, $2, 'redemption', 'submitted', 10) returning id",
      [owner, fund],
    )
    await expect(
      pool.query(
        "insert into redemption_requests (order_id, user_id, fund_id, requested_units, reserved_units, estimated_value_paise, finance_policy_version, requires_dual_approval) " +
          "values ($1, $2, $3, 10, 11, 100000, $4, false)",
        [order.rows[0]?.id, owner, fund, await activeFinancePolicyVersion()],
      ),
    ).rejects.toThrow()
  })
})
