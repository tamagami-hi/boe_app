import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { beginPayment } from "../../src/domain/client/beginPayment.js"
import { createOrder } from "../../src/domain/client/createOrder.js"
import { dispatchPayment } from "../../src/domain/client/settlePayment.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createHoldingRepository } from "../../src/repositories/holdingRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createPaymentRepository } from "../../src/repositories/paymentRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerPaymentWebhookRoutes, type PaymentWebhookDeps } from "../../src/routes/paymentWebhookRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const WEBHOOK_SECRET = "test-payment-webhook-secret"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let userId: string
let fundId: string

const orderRepository = createOrderRepository()
const paymentRepository = createPaymentRepository()
const holdingRepository = createHoldingRepository()
const notificationRepository = createNotificationRepository()
const outboxRepository = createOutboxRepository()
const userRepository = createUserRepository()
const auditRepository = createAuditRepository()
const clock = () => new Date()

let uow: ReturnType<typeof createUnitOfWork>

const createDeps = { orderRepository, userRepository, auditRepository, clock }
const beginDeps = {
  orderRepository,
  paymentRepository,
  outboxRepository,
  auditRepository,
  clock,
  config: { paymentProvider: "razorpay", attemptTtlMs: 900_000 },
}
const advanceDeps = {
  paymentRepository,
  orderRepository,
  holdingRepository,
  notificationRepository,
  auditRepository,
  clock,
  config: { paymentProvider: "razorpay" },
}

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const sign = (raw: string): string => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex")

/** Create + pay + dispatch a payment (real-provider path); returns { orderId, paymentId }. */
const createPaidPending = async (amountPaise: number): Promise<{ orderId: string; paymentId: string }> => {
  const orderId = await uow.execute(async (tx) => {
    const order = await createOrder(tx, createDeps, {
      userId,
      fundId,
      amountPaise: String(amountPaise),
      requestId: randomUUID(),
    })
    return order.id
  })
  await uow.execute((tx) => beginPayment(tx, beginDeps, { userId, orderId, requestId: randomUUID() }))
  const paymentRow = await pool.query<{ id: string }>("select id from payments where order_id = $1", [orderId])
  const paymentId = paymentRow.rows[0]!.id
  await uow.execute((tx) => dispatchPayment(tx, advanceDeps, { paymentId, requestId: randomUUID() }))
  return { orderId, paymentId }
}

const postWebhook = (payload: Record<string, unknown>, signature?: string) => {
  const raw = JSON.stringify(payload)
  return app.inject({
    method: "POST",
    url: "/v1/provider-events/payment",
    headers: { "content-type": "application/json", "x-payment-signature": signature ?? sign(raw) },
    payload: raw,
  })
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
  uow = createUnitOfWork(database)

  const deps: PaymentWebhookDeps = {
    unitOfWork: uow,
    paymentRepository,
    orderRepository,
    holdingRepository,
    notificationRepository,
    auditRepository,
    clock,
    config: { paymentProvider: "razorpay", webhookSecret: WEBHOOK_SECRET },
  }
  app = createApplication({ logger: false, registerRoutes: (instance) => registerPaymentWebhookRoutes(instance, deps) })

  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ('webhook@example.com','+14155551501','Webhook User','active', now()) returning id",
  )
  userId = user.rows[0]!.id
  await pool.query(
    "insert into kyc_cases (user_id, state, decided_at, expires_at) values ($1,'approved', now(), now() + interval '365 days')",
    [userId],
  )
  await pool.query(
    "insert into risk_assessments (user_id, state, questionnaire_version, score, category, submitted_at, assessed_at) " +
      "values ($1,'assessed','v1', 60, 'balanced', now(), now())",
    [userId],
  )
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ('webhook-fund','published', now(), $1) returning id",
    [userId],
  )
  fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1,1,'D','b',$2, now(), $3) returning id",
    [fundId, randomBytes(32), userId],
  )
  const nav = await pool.query<{ id: string }>(
    "insert into fund_nav_prices (fund_id, nav, as_of_date, revision, published_by_user_id) " +
      "values ($1, 20.00000000, current_date, 1, $2) returning id",
    [fundId, userId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, initial_nav_price_id, terms_sha256, created_by_user_id) " +
      "values ($1,1,'Webhook Fund','equity','grow','high', 50000, 100000, $2, $3, $4, $5) returning id",
    [fundId, disclosure.rows[0]!.id, nav.rows[0]!.id, randomBytes(32), userId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, fundId])
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("payment webhook confirmation checkpoint (integration)", () => {
  test("a signed success books the order and materializes the holding", async () => {
    const { orderId, paymentId } = await createPaidPending(200_000) // 100 units

    const response = await postWebhook({ paymentId, status: "succeeded", providerPaymentId: "pay_abc123" })
    expect(response.statusCode).toBe(200)
    expect(dataOf<{ outcome: string }>(response).outcome).toBe("booked")

    const order = await pool.query<{ state: string }>("select state from investment_orders where id = $1", [orderId])
    expect(order.rows[0]?.state).toBe("booked")
    const holding = await pool.query<{ total_units: string }>(
      "select total_units from holdings where user_id = $1 and fund_id = $2",
      [userId, fundId],
    )
    expect(holding.rows[0]?.total_units).toBe("100.00000000")
  })

  test("a signed success is idempotent on replay", async () => {
    const { paymentId } = await createPaidPending(100_000)
    const first = await postWebhook({ paymentId, status: "succeeded" })
    expect(dataOf<{ outcome: string }>(first).outcome).toBe("booked")
    const replay = await postWebhook({ paymentId, status: "succeeded" })
    expect(replay.statusCode).toBe(200)
    expect(dataOf<{ outcome: string }>(replay).outcome).toBe("already_booked")

    const executions = await pool.query<{ c: number }>(
      "select count(*)::int as c from investment_executions where order_id = (select order_id from payments where id = $1)",
      [paymentId],
    )
    expect(executions.rows[0]?.c).toBe(1)
  })

  test("a signed failure fails the payment and the order (no holding)", async () => {
    const { orderId, paymentId } = await createPaidPending(100_000)

    const response = await postWebhook({ paymentId, status: "failed", failureCode: "insufficient_funds" })
    expect(response.statusCode).toBe(200)
    expect(dataOf<{ outcome: string }>(response).outcome).toBe("failed")

    const order = await pool.query<{ state: string; failure_code: string | null }>(
      "select state, failure_code from investment_orders where id = $1",
      [orderId],
    )
    expect(order.rows[0]?.state).toBe("payment_failed")
    expect(order.rows[0]?.failure_code).toBe("insufficient_funds")
    const payment = await pool.query<{ state: string }>("select state from payments where order_id = $1", [orderId])
    expect(payment.rows[0]?.state).toBe("failed")
  })

  test("an invalid signature is rejected (401) and does not mutate", async () => {
    const { orderId, paymentId } = await createPaidPending(100_000)
    const response = await postWebhook({ paymentId, status: "succeeded" }, "deadbeef")
    expect(response.statusCode).toBe(401)
    expect(errorOf(response)).toBe("AUTHENTICATION_REQUIRED")

    const order = await pool.query<{ state: string }>("select state from investment_orders where id = $1", [orderId])
    expect(order.rows[0]?.state).toBe("payment_pending")
  })

  test("an unknown paymentId is RESOURCE_NOT_FOUND", async () => {
    const response = await postWebhook({ paymentId: randomUUID(), status: "succeeded" })
    expect(response.statusCode).toBe(404)
    expect(errorOf(response)).toBe("RESOURCE_NOT_FOUND")
  })
})
