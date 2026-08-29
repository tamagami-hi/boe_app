/**
 * Client catalog + activity read integration tests.
 *
 * Covers the client catalogue reads: published pools with their **Fund Size (AUM)**
 * and last-updated date, the administrator-curated **stock list** tagged by
 * quarter, and the owner-scoped order and payment detail. There is no per-unit
 * price anywhere in these projections — Option B has none.
 */
import { createUncachedCache } from "../../src/cache/cache.js"
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
import { createClientCatalogRepository } from "../../src/repositories/clientCatalogRepository.js"
import { createClientValueEntryRepository } from "../../src/repositories/clientValueEntryRepository.js"
import { createClientPortfolioRepository } from "../../src/repositories/clientPortfolioRepository.js"
import { registerClientCatalogRoutes } from "../../src/routes/clientCatalogRoutes.js"
import { registerClientPortfolioRoutes } from "../../src/routes/clientPortfolioRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let accessTokenService: AccessTokenService

let holderId: string
let holderToken: string
let otherToken: string
/** Published pool that also has an AUM snapshot (pool size shown to clients). */
let pooledFundId: string
/** Published pool with no AUM update yet: Fund Size is null. */
let noAumFundId: string
let draftFundId: string
let orderId: string
let paymentId: string

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

const seedUser = async (email: string): Promise<{ userId: string; token: string }> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1,$2,'Client Person','active', now()) returning id",
    [email, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
  )
  const userId = user.rows[0]!.id
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [userId],
  )
  const token = await accessTokenService.sign({ sub: userId, sid: session.rows[0]!.id })
  return { userId, token }
}

/** Publish a fund with a version and disclosure; returns the fund + version ids. */
const seedPublishedFund = async (
  slug: string,
  actorId: string,
  returnTier: "low" | "moderate" | "high" | null,
): Promise<{ fundId: string; versionId: string }> => {
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1,'published', now(), $2) returning id",
    [slug, actorId],
  )
  const fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), actorId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
      "minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, " +
      "terms_sha256, created_by_user_id) " +
      "values ($1, 1, $2, 'hybrid', 'Balanced growth.', 'moderate', $3, 50000, 500000, 6, $4, $5, $6) returning id",
    [fundId, `Fund ${slug}`, returnTier, disclosure.rows[0]!.id, randomBytes(32), actorId],
  )
  const versionId = version.rows[0]!.id
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [
    versionId,
    fundId,
  ])
  return { fundId, versionId }
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
  await runMigrations(pool, await loadMigrationFiles(directory))
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

  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerClientPortfolioRoutes(instance, {
        accessTokenService,
        database,
        clientWeb: { originAllowlist: [] },
        clientPortfolioRepository: createClientPortfolioRepository(),
        clientValueEntryRepository: createClientValueEntryRepository(),
        unitOfWork: createUnitOfWork(database),
        clock: () => new Date(),
        config: { cursorKey: randomBytes(32) },
      })
      registerClientCatalogRoutes(instance, {
        accessTokenService,
        database,
        clientWeb: { originAllowlist: [] },
        clock: () => new Date(),
        cache: createUncachedCache(),
        config: { cursorKey: randomBytes(32), catalogTtlMs: 0 },
        clientCatalogRepository: createClientCatalogRepository(),
      })
    },
  })

  const holder = await seedUser("holder@example.com")
  holderId = holder.userId
  holderToken = holder.token
  const other = await seedUser("other@example.com")
  otherToken = other.token

  const pooled = await seedPublishedFund("pooled-fund", holderId, "moderate")
  pooledFundId = pooled.fundId
  const noAum = await seedPublishedFund("no-aum-fund", holderId, null)
  noAumFundId = noAum.fundId

  const draft = await pool.query<{ id: string }>(
    "insert into funds (slug, state, created_by_user_id) values ('draft-fund','draft',$1) returning id",
    [holderId],
  )
  draftFundId = draft.rows[0]!.id

  // "Fund Size (AUM)": the latest published snapshot is ₹1,00,000 (10,000,000 paise).
  await pool.query(
    "insert into fund_aum_snapshots (fund_id, as_of_date, aum_paise, reason_code, published_by_user_id, request_id) " +
      "values ($1, '2026-07-31', 10000000, 'monthly_publication', $2, $3)",
    [pooledFundId, holderId, randomUUID()],
  )

  // The disclosed stock list, one active and one exited.
  await pool.query(
    "insert into fund_stock_disclosures (fund_id, stock_name, quarter_label, weight_percent, sort_order, added_by_user_id) " +
      "values ($1, 'SJS Enterprises', 'Q1 FY27', 4.25, 1, $2), ($1, 'HDFC Bank', 'Q1 FY27', null, 2, $2)",
    [pooledFundId, holderId],
  )
  await pool.query(
    "insert into fund_stock_disclosures (fund_id, stock_name, quarter_label, sort_order, state, exited_at, added_by_user_id) " +
      "values ($1, 'Old Holding', 'Q4 FY26', 3, 'exited', now(), $2)",
    [pooledFundId, holderId],
  )

  const order = await pool.query<{ id: string }>(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, requested_at) " +
      "values ($1,$2,$3,'lump_sum','payment_pending', 500000, now()) returning id",
    [holderId, pooledFundId, pooled.versionId],
  )
  orderId = order.rows[0]!.id
  const payment = await pool.query<{ id: string }>(
    "insert into payments (order_id, user_id, amount_paise, state) values ($1,$2, 500000, 'provider_pending') returning id",
    [orderId, holderId],
  )
  paymentId = payment.rows[0]!.id
  await pool.query(
    "insert into payment_attempts (payment_id, user_id, attempt_number, provider, merchant_order_id, provider_order_id, state, checkout_expires_at) " +
      "values ($1,$2, 1, 'phonepe', 'boe_test_123', 'pay_mock_123', 'provider_pending', now() + interval '15 minutes')",
    [paymentId, holderId],
  )
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("client fund catalogue (integration)", () => {
  test("lists only published pools with their Fund Size and last-updated date", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/funds",
      headers: bearer(holderToken),
    })
    expect(response.statusCode).toBe(200)
    const items = dataOf<{ items: Record<string, unknown>[] }>(response).items
    const slugs = items.map((item) => item.slug)
    expect(slugs).toContain("pooled-fund")
    expect(slugs).toContain("no-aum-fund")
    expect(slugs).not.toContain("draft-fund")

    const pooled = items.find((item) => item.slug === "pooled-fund")
    expect(pooled).toMatchObject({
      name: "Fund pooled-fund",
      category: "hybrid",
      riskLevel: "moderate",
      returnTier: "moderate",
      status: "published",
      minimumSipPaise: "50000",
      minimumPurchasePaise: "500000",
      minimumDurationMonths: 6,
    })
    // Fund Size is the latest published AUM snapshot, with its effective date
    // and when the administrator entered it. No price is exposed — there is none.
    expect(pooled?.fundSize).toMatchObject({ aumPaise: "10000000", asOfDate: "2026-07-31" })
    expect((pooled?.fundSize as { lastUpdatedAt: string }).lastUpdatedAt).not.toBeNull()
    expect(pooled).not.toHaveProperty("price")
    expect(pooled?.stockCount).toBe(2)

    // A pool with no published AUM update yet reports no Fund Size rather than zero.
    const noAum = items.find((item) => item.id === noAumFundId)
    expect(noAum?.slug).toBe("no-aum-fund")
    expect(noAum?.fundSize).toBeNull()
  })

  test("returns one pool with its quarterly stock list and disclosure", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/client/funds/${pooledFundId}`,
      headers: bearer(holderToken),
    })
    expect(response.statusCode).toBe(200)
    const body = dataOf<{
      fund: { slug: string }
      stocks: { stockName: string; quarterLabel: string; weightPercent: string | null }[]
      disclosure: { title: string; body: string } | null
    }>(response)
    expect(body.fund.slug).toBe("pooled-fund")
    // Active entries only, in the administrator's order; the exited one is hidden.
    expect(body.stocks.map((stock) => stock.stockName)).toEqual(["SJS Enterprises", "HDFC Bank"])
    expect(body.stocks[0]?.quarterLabel).toBe("Q1 FY27")
    expect(Number(body.stocks[0]?.weightPercent)).toBe(4.25)
    expect(body.stocks[1]?.weightPercent).toBeNull()
    expect(body.disclosure).toMatchObject({ title: "Scheme disclosure", body: "Full disclosure body." })
  })

  test("hides unpublished and unknown pools, and requires a bearer token", async () => {
    const draft = await app.inject({
      method: "GET",
      url: `/v1/client/funds/${draftFundId}`,
      headers: bearer(holderToken),
    })
    expect(draft.statusCode).toBe(404)

    const unknown = await app.inject({
      method: "GET",
      url: `/v1/client/funds/${randomUUID()}`,
      headers: bearer(holderToken),
    })
    expect(unknown.statusCode).toBe(404)

    const anonymous = await app.inject({ method: "GET", url: "/v1/client/funds" })
    expect(anonymous.statusCode).toBe(401)
    expect(errorOf(anonymous)).toBe("AUTHENTICATION_REQUIRED")

    const badCursor = await app.inject({
      method: "GET",
      url: "/v1/client/funds?after=not-a-cursor",
      headers: bearer(holderToken),
    })
    expect(badCursor.statusCode).toBe(400)
  })
})

describe("client order and payment detail (integration)", () => {
  test("returns one order the caller owns and hides another user's order", async () => {
    const mine = await app.inject({
      method: "GET",
      url: `/v1/client/orders/${orderId}`,
      headers: bearer(holderToken),
    })
    expect(mine.statusCode).toBe(200)
    expect(dataOf<{ order: Record<string, unknown> }>(mine).order).toMatchObject({
      orderId,
      fundId: pooledFundId,
      type: "lump_sum",
      // Client-safe projection (spec §9.2): the raw internal state never crosses.
      status: "payment_in_progress",
      amountPaise: "500000",
    })

    const theirs = await app.inject({
      method: "GET",
      url: `/v1/client/orders/${orderId}`,
      headers: bearer(otherToken),
    })
    expect(theirs.statusCode).toBe(404)
  })

  test("returns the payment with its latest attempt, owner-scoped", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/client/payments/${paymentId}`,
      headers: bearer(holderToken),
    })
    expect(response.statusCode).toBe(200)
    expect(dataOf<{ payment: Record<string, unknown> }>(response).payment).toMatchObject({
      paymentId,
      orderId,
      fundId: pooledFundId,
      amountPaise: "500000",
      status: "payment_in_progress",
      provider: "phonepe",
      attemptStatus: "provider_pending",
    })

    const theirs = await app.inject({
      method: "GET",
      url: `/v1/client/payments/${paymentId}`,
      headers: bearer(otherToken),
    })
    expect(theirs.statusCode).toBe(404)

    const unknown = await app.inject({
      method: "GET",
      url: `/v1/client/payments/${randomUUID()}`,
      headers: bearer(holderToken),
    })
    expect(unknown.statusCode).toBe(404)
  })
})
