import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createClientPortfolioRepository } from "../../src/repositories/clientPortfolioRepository.js"
import { createInvestorLedgerRepository } from "../../src/repositories/investorLedgerRepository.js"
import { createRedemptionRepository } from "../../src/repositories/redemptionRepository.js"
import {
  registerClientPortfolioRoutes,
  type ClientPortfolioDeps,
} from "../../src/routes/clientPortfolioRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let accessTokenService: AccessTokenService

// user ids
let eligibleUserId: string
let pendingUserId: string
// bearer tokens
let eligibleToken: string
let pendingToken: string
let suspendedToken: string
let fundId: string

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const pageOf = (response: { json: () => unknown }): { nextCursor: string | null; hasMore: boolean } =>
  (response.json() as { meta: { page: { nextCursor: string | null; hasMore: boolean } } }).meta.page

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

/** Insert an active user + active native session; return {userId, token}. */
const seedActiveUserWithSession = async (
  email: string,
  phone: string,
  accountState: "active" | "suspended",
): Promise<{ userId: string; token: string }> => {
  const suspendedColumn = accountState === "suspended" ? ", suspended_at" : ""
  const suspendedValue = accountState === "suspended" ? ", now()" : ""
  const user = await pool.query<{ id: string }>(
    `insert into users (email_normalized, phone_e164, full_name, account_state, activated_at${suspendedColumn}) ` +
      `values ($1,$2,$3,$4, now()${suspendedValue}) returning id`,
    [email, phone, "Test User", accountState],
  )
  const userId = user.rows[0]!.id
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [userId],
  )
  const sessionId = session.rows[0]!.id
  const token = await accessTokenService.sign({ sub: userId, sid: sessionId })
  return { userId, token }
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
  const migrations = await loadMigrationFiles(directory)
  await runMigrations(pool, migrations)
  await runSeed(pool)

  const database = createDatabase(pool)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })

  const deps: ClientPortfolioDeps = {
    accessTokenService,
    database,
    clientPortfolioRepository: createClientPortfolioRepository(),
    investorLedgerRepository: createInvestorLedgerRepository(),
    redemptionRepository: createRedemptionRepository(),
    auditRepository: createAuditRepository(),
    unitOfWork: createUnitOfWork(database),
    clock: () => new Date(),
    config: { cursorKey: randomBytes(32) },
  }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => registerClientPortfolioRoutes(instance, deps),
  })

  // --- users + sessions ---
  const eligible = await seedActiveUserWithSession("eligible@example.com", "+14155550101", "active")
  eligibleUserId = eligible.userId
  eligibleToken = eligible.token
  const pending = await seedActiveUserWithSession("pending@example.com", "+14155550102", "active")
  pendingUserId = pending.userId
  pendingToken = pending.token
  const suspended = await seedActiveUserWithSession("suspended@example.com", "+14155550103", "suspended")
  suspendedToken = suspended.token

  // eligible user: approved (non-expired) KYC + assessed risk
  await pool.query(
    "insert into kyc_cases (user_id, state, decided_at, expires_at) values ($1,'approved', now(), now() + interval '365 days')",
    [eligibleUserId],
  )
  await pool.query(
    "insert into risk_assessments (user_id, state, questionnaire_version, score, category, submitted_at, assessed_at) " +
      "values ($1,'assessed','v1', 60, 'balanced', now(), now())",
    [eligibleUserId],
  )
  // pending user: an in_review KYC (not approved) and no assessed risk
  await pool.query("insert into kyc_cases (user_id, state) values ($1,'submitted')", [pendingUserId])

  // --- catalog: a published fund with a current version + current NAV ---
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) " +
      "values ('growth-fund','published', now(), $1) returning id",
    [eligibleUserId],
  )
  fundId = fund.rows[0]!.id
  const digest = randomBytes(32)
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Disclosure', 'body', $2, now(), $3) returning id",
    [fundId, digest, eligibleUserId],
  )
  const nav = await pool.query<{ id: string }>(
    "insert into fund_nav_prices (fund_id, nav, as_of_date, revision, published_by_user_id) " +
      "values ($1, 25.50000000, current_date, 1, $2) returning id",
    [fundId, eligibleUserId],
  )
  // a superseding NAV revision for the same date must be chosen over revision 1
  await pool.query(
    "insert into fund_nav_prices (fund_id, nav, as_of_date, revision, published_by_user_id) " +
      "values ($1, 30.00000000, current_date, 2, $2)",
    [fundId, eligibleUserId],
  )
  const fundVersion = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, initial_nav_price_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'BeOnEdge Growth', 'equity', 'grow capital', 'high', 50000, 500000, $2, $3, $4, $5) returning id",
    [fundId, disclosure.rows[0]!.id, nav.rows[0]!.id, randomBytes(32), eligibleUserId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [
    fundVersion.rows[0]!.id,
    fundId,
  ])

  // --- ledger: ₹1,00,000 lump sum + ₹25,000 SIP + a ₹12,500 allocated gain ---
  const ledger = async (
    type: "lump_sum" | "sip_installment" | "gain_allocation",
    amountPaise: number,
    date: string,
  ): Promise<void> => {
    const principal = type === "gain_allocation" ? 0 : amountPaise
    const allocator = type === "gain_allocation" ? eligibleUserId : null
    await pool.query(
      "insert into investor_ledger_entries (user_id, fund_id, entry_type, principal_delta_paise, " +
        "value_delta_paise, amount_paise, effective_date, allocated_by_user_id, request_id) " +
        "values ($1,$2,$3,$4,$5,$6,$7::date,$8,$9)",
      [eligibleUserId, fundId, type, principal, amountPaise, amountPaise, date, allocator, randomUUID()],
    )
  }
  // Redemptions reference the active finance policy version (the deploy seed
  // publishes version 1; this harness runs the catalog seed only).
  await pool.query(
    "insert into finance_policy_versions (version, effective_from, published_by_user_id) " +
      "values (1, now(), $1) on conflict (version) do nothing",
    [eligibleUserId],
  )

  await ledger("lump_sum", 10_000_000, "2026-01-10")
  await ledger("sip_installment", 2_500_000, "2026-02-05")
  await ledger("gain_allocation", 1_250_000, "2026-07-31")

  // --- orders: three purchase orders with distinct created_at for pagination ---
  for (let index = 0; index < 3; index += 1) {
    await pool.query(
      "insert into investment_orders (user_id, fund_id, type, state, amount_paise, requested_at, created_at) " +
        `values ($1,$2,'purchase','submitted', $3, now(), now() - interval '${index} hours')`,
      [eligibleUserId, fundId, 100000 + index],
    )
  }
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("client portfolio reads (integration)", () => {
  test("eligibility: active user with approved KYC + assessed risk is eligible", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/client/eligibility", headers: bearer(eligibleToken) })
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ eligibility: string; canInvest: boolean; reason: string | null }>(response)
    expect(body.eligibility).toBe("eligible")
    expect(body.canInvest).toBe(true)
    expect(body.reason).toBeNull()
  })

  test("eligibility: active user without approved KYC is pending_compliance", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/client/eligibility", headers: bearer(pendingToken) })
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ eligibility: string; canInvest: boolean; reason: string }>(response)
    expect(body.eligibility).toBe("pending_compliance")
    expect(body.canInvest).toBe(false)
    expect(body.reason).toBe("kyc_required")
  })

  test("eligibility: a non-active (suspended) principal is rejected before any read", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/eligibility",
      headers: bearer(suspendedToken),
    })
    expect(response.statusCode).toBe(403)
    expect(errorOf(response)).toBe("ACCOUNT_NOT_ACTIVE")
  })

  test("eligibility: a missing bearer is AUTHENTICATION_REQUIRED", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/client/eligibility" })
    expect(response.statusCode).toBe(401)
    expect(errorOf(response)).toBe("AUTHENTICATION_REQUIRED")
  })

  test("portfolio: derives My Investment and the Investment Summary from the ledger", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/portfolio",
      headers: bearer(eligibleToken),
    })
    expect(response.statusCode).toBe(200)
    const body = dataOf<{
      currentValuePaise: string
      totalInvestmentPaise: string
      totalReturnPaise: string
      returnPercent: number
      returnSince: string
      lastUpdated: string
      summary: Record<string, unknown>
      pools: { fundId: string; currentValuePaise: string }[]
    }>(response)

    // ₹1,25,000 invested, ₹12,500 allocated => ₹1,37,500 value, +10%.
    expect(body).toMatchObject({
      totalInvestmentPaise: "12500000",
      currentValuePaise: "13750000",
      totalReturnPaise: "1250000",
      returnPercent: 10,
      // "Return Since First Investment" is the earliest contribution, not the
      // earliest event of any kind.
      returnSince: "2026-01-10",
      lastUpdated: "2026-07-31",
    })
    expect(body.summary).toMatchObject({
      sipInstallmentCount: 1,
      sipTotalPaise: "2500000",
      lumpSumCount: 1,
      lumpSumTotalPaise: "10000000",
      redemptionCount: 0,
      allocatedGainPaise: "1250000",
    })
    expect(body.pools).toHaveLength(1)
    expect(body.pools[0]).toMatchObject({ fundId, currentValuePaise: "13750000" })
  })

  test("portfolio: an investor with no ledger sees zeros, not an error", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/portfolio",
      headers: bearer(pendingToken),
    })
    expect(response.statusCode).toBe(200)
    expect(dataOf<Record<string, unknown>>(response)).toMatchObject({
      totalInvestmentPaise: "0",
      currentValuePaise: "0",
      returnPercent: null,
      returnSince: null,
    })
  })

  test("transactions: the dated ledger behind the dashboard, newest first", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/transactions?limit=10",
      headers: bearer(eligibleToken),
    })
    expect(response.statusCode).toBe(200)
    const items = dataOf<{ items: { type: string; amountPaise: string; date: string; principalDeltaPaise: string }[] }>(
      response,
    ).items
    expect(items.map((item) => item.type)).toEqual(["gain_allocation", "sip_installment", "lump_sum"])
    // An allocated gain moves value but never invested principal.
    expect(items[0]).toMatchObject({ amountPaise: "1250000", principalDeltaPaise: "0" })

    const other = await app.inject({
      method: "GET",
      url: "/v1/client/transactions",
      headers: bearer(pendingToken),
    })
    expect(dataOf<{ items: unknown[] }>(other).items).toHaveLength(0)
  })

  test("redemption: returns-only draws the gain and leaves principal intact", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/redemptions",
      headers: bearer(eligibleToken),
      payload: { fundId, mode: "returns_only" },
    })
    expect(response.statusCode).toBe(201)
    const body = dataOf<{
      redemption: {
        id: string
        mode: string
        status: string
        requestedAmountPaise: string
        principalComponentPaise: string
        returnsComponentPaise: string
      }
      availableValuePaise: string
    }>(response)
    expect(body.availableValuePaise).toBe("13750000")
    expect(body.redemption).toMatchObject({
      mode: "returns_only",
      status: "submitted",
      requestedAmountPaise: "1250000",
      principalComponentPaise: "0",
      returnsComponentPaise: "1250000",
    })

    // The request does not move the investor's value: only settlement does.
    const after = await app.inject({
      method: "GET",
      url: "/v1/client/portfolio",
      headers: bearer(eligibleToken),
    })
    expect(dataOf<{ currentValuePaise: string }>(after).currentValuePaise).toBe("13750000")

    // A second open request for the same pool is refused.
    const second = await app.inject({
      method: "POST",
      url: "/v1/client/redemptions",
      headers: bearer(eligibleToken),
      payload: { fundId, mode: "half" },
    })
    expect(second.statusCode).toBe(409)

    const listed = await app.inject({
      method: "GET",
      url: "/v1/client/redemptions",
      headers: bearer(eligibleToken),
    })
    expect(dataOf<{ items: { id: string }[] }>(listed).items[0]?.id).toBe(body.redemption.id)
  })

  test("redemption: guards a custom amount, an empty position, and a missing amount", async () => {
    // No ledger at all in this pool.
    const noPosition = await app.inject({
      method: "POST",
      url: "/v1/client/redemptions",
      headers: bearer(pendingToken),
      payload: { fundId, mode: "full" },
    })
    expect(noPosition.statusCode).toBe(409)

    const missingAmount = await app.inject({
      method: "POST",
      url: "/v1/client/redemptions",
      headers: bearer(eligibleToken),
      payload: { fundId, mode: "custom" },
    })
    expect(missingAmount.statusCode).toBe(400)

    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/client/redemptions",
      payload: { fundId, mode: "full" },
    })
    expect(anonymous.statusCode).toBe(401)
  })

  test("orders: keyset pagination returns a stable, owner-scoped history", async () => {
    // The exact order count depends on what other cases in this file have
    // submitted (a redemption also records an order), so assert the paging
    // contract rather than a fixed total.
    const first = await app.inject({
      method: "GET",
      url: "/v1/client/orders?limit=2",
      headers: bearer(eligibleToken),
    })
    expect(first.statusCode).toBe(200)
    const firstItems = dataOf<{ items: { orderId: string; amountPaise: string }[] }>(first).items
    expect(firstItems).toHaveLength(2)
    const firstPage = pageOf(first)
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.nextCursor).not.toBeNull()

    const second = await app.inject({
      method: "GET",
      url: `/v1/client/orders?limit=2&after=${encodeURIComponent(firstPage.nextCursor!)}`,
      headers: bearer(eligibleToken),
    })
    expect(second.statusCode).toBe(200)
    const secondItems = dataOf<{ items: { orderId: string }[] }>(second).items
    expect(secondItems.length).toBeGreaterThan(0)

    // Pages never overlap.
    const ids = new Set([...firstItems.map((o) => o.orderId), ...secondItems.map((o) => o.orderId)])
    expect(ids.size).toBe(firstItems.length + secondItems.length)
  })

  test("cursor: a tampered orders cursor is CURSOR_INVALID", async () => {
    const ordersFirst = await app.inject({
      method: "GET",
      url: "/v1/client/orders?limit=1",
      headers: bearer(eligibleToken),
    })
    const cursor = pageOf(ordersFirst).nextCursor
    expect(cursor).not.toBeNull()
    const replay = await app.inject({
      method: "GET",
      url: `/v1/client/orders?limit=1&after=${encodeURIComponent(`${cursor!}x`)}`,
      headers: bearer(eligibleToken),
    })
    expect(replay.statusCode).toBe(400)
    expect(errorOf(replay)).toBe("CURSOR_INVALID")
  })

  test("unknown user id in a valid-looking session is SESSION_INVALID", async () => {
    const token = await accessTokenService.sign({ sub: randomUUID(), sid: randomUUID() })
    const response = await app.inject({ method: "GET", url: "/v1/client/orders", headers: bearer(token) })
    expect(response.statusCode).toBe(401)
    expect(errorOf(response)).toBe("SESSION_INVALID")
  })

  test("orders keeps other users' orders out of the result", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/client/orders", headers: bearer(pendingToken) })
    expect(response.statusCode).toBe(200)
    expect(dataOf<{ items: unknown[] }>(response).items).toHaveLength(0)
  })
})
