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
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createPaymentRepository } from "../../src/repositories/paymentRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerClientOrderRoutes, type ClientOrderDeps } from "../../src/routes/clientOrderRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let accessTokenService: AccessTokenService

let eligibleToken: string
let otherEligibleToken: string
let pendingToken: string
let publishedFundId: string
let draftFundId: string

const MIN_PURCHASE_PAISE = 500_000 // ₹5,000

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const replayOf = (response: { json: () => unknown }): boolean =>
  ((response.json() as { meta: { idempotencyReplay?: boolean } }).meta.idempotencyReplay ?? false)

const bearer = (token: string, idempotencyKey?: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
})

const seedEligibleUser = async (
  email: string,
  phone: string,
  opts: Readonly<{ approvedKyc: boolean }>,
): Promise<string> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1,$2,$3,'active', now()) returning id",
    [email, phone, "Order User"],
  )
  const userId = user.rows[0]!.id
  if (opts.approvedKyc) {
    await pool.query(
      "insert into kyc_cases (user_id, state, decided_at, expires_at) values ($1,'approved', now(), now() + interval '365 days')",
      [userId],
    )
    await pool.query(
      "insert into risk_assessments (user_id, state, questionnaire_version, score, category, submitted_at, assessed_at) " +
        "values ($1,'assessed','v1', 60, 'balanced', now(), now())",
      [userId],
    )
  }
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [userId],
  )
  return accessTokenService.sign({ sub: userId, sid: session.rows[0]!.id })
}

const seedPublishedFund = async (slug: string): Promise<string> => {
  // Any active user id works as the catalog publisher; reuse an existing user.
  const owner = await pool.query<{ id: string }>("select id from users limit 1")
  const ownerId = owner.rows[0]!.id
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1,'published', now(), $2) returning id",
    [slug, ownerId],
  )
  const fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1,1,'D','b',$2, now(), $3) returning id",
    [fundId, randomBytes(32), ownerId],
  )
  const nav = await pool.query<{ id: string }>(
    "insert into fund_nav_prices (fund_id, nav, as_of_date, revision, published_by_user_id) " +
      "values ($1, 20.00000000, current_date, 1, $2) returning id",
    [fundId, ownerId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, initial_nav_price_id, terms_sha256, created_by_user_id) " +
      "values ($1,1,'Growth','equity','grow','high', 50000, $2, $3, $4, $5, $6) returning id",
    [fundId, MIN_PURCHASE_PAISE, disclosure.rows[0]!.id, nav.rows[0]!.id, randomBytes(32), ownerId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, fundId])
  return fundId
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

  const deps: ClientOrderDeps = {
    accessTokenService,
    database,
    unitOfWork: createUnitOfWork(database),
    clock: () => new Date(),
    orderRepository: createOrderRepository(),
    paymentRepository: createPaymentRepository(),
    userRepository: createUserRepository(),
    outboxRepository: createOutboxRepository(),
    auditRepository: createAuditRepository(),
    idempotencyRepository: createIdempotencyRepository(),
    config: { idempotencyTtlMs: 86_400_000, paymentProvider: "manual", attemptTtlMs: 900_000 },
  }
  app = createApplication({ logger: false, registerRoutes: (instance) => registerClientOrderRoutes(instance, deps) })

  eligibleToken = await seedEligibleUser("eligible-order@example.com", "+14155551201", { approvedKyc: true })
  otherEligibleToken = await seedEligibleUser("eligible-order2@example.com", "+14155551202", { approvedKyc: true })
  pendingToken = await seedEligibleUser("pending-order@example.com", "+14155551203", { approvedKyc: false })
  publishedFundId = await seedPublishedFund("growth-order-fund")

  const draft = await pool.query<{ id: string }>("select id from users limit 1")
  const draftFund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, created_by_user_id) values ('draft-fund','draft', $1) returning id",
    [draft.rows[0]!.id],
  )
  draftFundId = draftFund.rows[0]!.id
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const createOrder = (token: string, fundId: string, amountPaise: number, key: string) =>
  app.inject({
    method: "POST",
    url: "/v1/client/orders",
    headers: bearer(token, key),
    payload: { fundId, amountPaise },
  })

describe("client order write path (integration)", () => {
  test("eligible client creates a submitted purchase order", async () => {
    const response = await createOrder(eligibleToken, publishedFundId, 1_000_000, randomUUID())
    expect(response.statusCode).toBe(201)
    const body = dataOf<{ orderId: string; status: string; amountPaise: string; currency: string }>(response)
    expect(body.status).toBe("submitted")
    expect(body.amountPaise).toBe("1000000")
    expect(body.currency).toBe("INR")

    const row = await pool.query<{ state: string; type: string }>(
      "select state, type from investment_orders where id = $1",
      [body.orderId],
    )
    expect(row.rows[0]).toEqual({ state: "submitted", type: "purchase" })
  })

  test("same Idempotency-Key replays the first order without a second row", async () => {
    const key = randomUUID()
    const first = await createOrder(eligibleToken, publishedFundId, 900_000, key)
    const second = await createOrder(eligibleToken, publishedFundId, 900_000, key)
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    const firstId = dataOf<{ orderId: string }>(first).orderId
    expect(dataOf<{ orderId: string }>(second).orderId).toBe(firstId)
    expect(replayOf(second)).toBe(true)

    const count = await pool.query<{ c: number }>(
      "select count(*)::int as c from investment_orders where user_id = (select user_id from investment_orders where id = $1) and amount_paise = 900000",
      [firstId],
    )
    expect(count.rows[0]?.c).toBe(1)
  })

  test("an amount below the fund minimum is VALIDATION_FAILED", async () => {
    const response = await createOrder(eligibleToken, publishedFundId, MIN_PURCHASE_PAISE - 1, randomUUID())
    expect(response.statusCode).toBe(400)
    expect(errorOf(response)).toBe("VALIDATION_FAILED")
  })

  test("ordering an unpublished (draft) fund is STATE_CONFLICT", async () => {
    const response = await createOrder(eligibleToken, draftFundId, 1_000_000, randomUUID())
    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toBe("STATE_CONFLICT")
  })

  test("an ineligible client (no approved KYC) cannot create an order", async () => {
    const response = await createOrder(pendingToken, publishedFundId, 1_000_000, randomUUID())
    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toBe("STATE_CONFLICT")
  })

  test("a missing Idempotency-Key is rejected", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: { authorization: `Bearer ${eligibleToken}` },
      payload: { fundId: publishedFundId, amountPaise: 1_000_000 },
    })
    expect(response.statusCode).toBe(400)
    expect(errorOf(response)).toBe("VALIDATION_FAILED")
  })

  test("begin payment moves the order to payment_pending and creates payment + attempt + outbox", async () => {
    const created = await createOrder(eligibleToken, publishedFundId, 1_500_000, randomUUID())
    const orderId = dataOf<{ orderId: string }>(created).orderId

    const pay = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: bearer(eligibleToken, randomUUID()),
    })
    expect(pay.statusCode).toBe(202)
    const body = dataOf<{ status: string; paymentId: string; paymentAttemptId: string; amountPaise: string }>(pay)
    expect(body.status).toBe("payment_pending")
    expect(body.amountPaise).toBe("1500000")

    const order = await pool.query<{ state: string }>("select state from investment_orders where id = $1", [orderId])
    expect(order.rows[0]?.state).toBe("payment_pending")
    const payment = await pool.query<{ state: string; amount_paise: string }>(
      "select state, amount_paise from payments where id = $1",
      [body.paymentId],
    )
    expect(payment.rows[0]).toEqual({ state: "created", amount_paise: "1500000" })
    const attempt = await pool.query<{ attempt_number: number; provider: string }>(
      "select attempt_number, provider from payment_attempts where id = $1",
      [body.paymentAttemptId],
    )
    expect(attempt.rows[0]).toEqual({ attempt_number: 1, provider: "manual" })
    const outbox = await pool.query<{ c: number }>(
      "select count(*)::int as c from outbox_events where topic = 'payment' and aggregate_id = $1",
      [body.paymentId],
    )
    expect(outbox.rows[0]?.c).toBe(1)
  })

  test("begin payment is idempotent on replay and conflicts on a second key", async () => {
    const created = await createOrder(eligibleToken, publishedFundId, 800_000, randomUUID())
    const orderId = dataOf<{ orderId: string }>(created).orderId
    const key = randomUUID()

    const first = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: bearer(eligibleToken, key),
    })
    const replay = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: bearer(eligibleToken, key),
    })
    expect(first.statusCode).toBe(202)
    expect(replay.statusCode).toBe(202)
    expect(replayOf(replay)).toBe(true)
    expect(dataOf<{ paymentId: string }>(replay).paymentId).toBe(dataOf<{ paymentId: string }>(first).paymentId)

    // A fresh key against the now payment_pending order fails the state guard.
    const conflict = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: bearer(eligibleToken, randomUUID()),
    })
    expect(conflict.statusCode).toBe(409)
    expect(errorOf(conflict)).toBe("STATE_CONFLICT")
  })

  test("paying an unknown order is RESOURCE_NOT_FOUND", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${randomUUID()}/pay`,
      headers: bearer(eligibleToken, randomUUID()),
    })
    expect(response.statusCode).toBe(404)
    expect(errorOf(response)).toBe("RESOURCE_NOT_FOUND")
  })

  test("a client cannot pay another client's order (owner-scoped)", async () => {
    const created = await createOrder(eligibleToken, publishedFundId, 700_000, randomUUID())
    const orderId = dataOf<{ orderId: string }>(created).orderId
    const response = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: bearer(otherEligibleToken, randomUUID()),
    })
    expect(response.statusCode).toBe(404)
    expect(errorOf(response)).toBe("RESOURCE_NOT_FOUND")
  })
})
