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
})
