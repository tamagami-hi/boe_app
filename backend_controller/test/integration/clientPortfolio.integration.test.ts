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
import { createDatabase } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { createClientPortfolioRepository } from "../../src/repositories/clientPortfolioRepository.js"
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
  const all = await loadMigrationFiles(directory)
  await runMigrations(
    pool,
    all.filter((file) => file.version >= "009"),
  )
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

  // --- holdings: 10 units at current NAV 30.00 => 300.00 => 30000 paise ---
  await pool.query(
    "insert into holdings (user_id, fund_id, total_units, reserved_units, cost_basis_paise) " +
      "values ($1,$2, 10.00000000, 2.00000000, 25000)",
    [eligibleUserId, fundId],
  )

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

  test("holdings: valued at the greatest-revision current NAV, with money/units as strings", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/client/holdings", headers: bearer(eligibleToken) })
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ items: Record<string, unknown>[] }>(response)
    expect(body.items).toHaveLength(1)
    const holding = body.items[0]!
    expect(holding.fundId).toBe(fundId)
    expect(holding.fundName).toBe("BeOnEdge Growth")
    expect(holding.totalUnits).toBe("10.00000000")
    expect(holding.reservedUnits).toBe("2.00000000")
    expect(holding.availableUnits).toBe("8.00000000")
    // 10 units * 30.00 NAV (revision 2 wins) * 100 = 30000 paise
    expect(holding.currentNav).toBe("30.00000000")
    expect(holding.marketValuePaise).toBe("30000")
    expect(holding.costBasisPaise).toBe("25000")
  })

  test("holdings: another user sees none of the eligible user's holdings", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/client/holdings", headers: bearer(pendingToken) })
    expect(response.statusCode).toBe(200)
    expect(dataOf<{ items: unknown[] }>(response).items).toHaveLength(0)
  })

  test("orders: keyset pagination returns a stable, owner-scoped history", async () => {
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
    expect(secondItems).toHaveLength(1)
    expect(pageOf(second).hasMore).toBe(false)

    // no overlap across pages
    const ids = new Set([...firstItems.map((o) => o.orderId), ...secondItems.map((o) => o.orderId)])
    expect(ids.size).toBe(3)
  })

  test("cursor: an orders cursor replayed against the holdings route is CURSOR_INVALID", async () => {
    const ordersFirst = await app.inject({
      method: "GET",
      url: "/v1/client/orders?limit=1",
      headers: bearer(eligibleToken),
    })
    const cursor = pageOf(ordersFirst).nextCursor
    expect(cursor).not.toBeNull()
    const replay = await app.inject({
      method: "GET",
      url: `/v1/client/holdings?limit=1&after=${encodeURIComponent(cursor!)}`,
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
