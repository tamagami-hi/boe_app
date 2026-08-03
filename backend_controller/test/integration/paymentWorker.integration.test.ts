import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork, type UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { beginPayment } from "../../src/domain/client/beginPayment.js"
import { createOrder } from "../../src/domain/client/createOrder.js"
import { settleDuePayments, type SettleDuePaymentsDeps } from "../../src/domain/client/settlePayment.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createInvestorLedgerRepository } from "../../src/repositories/investorLedgerRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createPaymentRepository } from "../../src/repositories/paymentRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let uow: UnitOfWork
let workerDeps: SettleDuePaymentsDeps
let userId: string
let fundId: string

const orderRepository = createOrderRepository()
const paymentRepository = createPaymentRepository()
const investorLedgerRepository = createInvestorLedgerRepository()
const notificationRepository = createNotificationRepository()
const userRepository = createUserRepository()
const outboxRepository = createOutboxRepository()
const auditRepository = createAuditRepository()
const clock = () => new Date()

const createDeps = { orderRepository, userRepository, auditRepository, clock }
const beginDeps = {
  orderRepository,
  paymentRepository,
  outboxRepository,
  auditRepository,
  clock,
  config: { paymentProvider: "manual", attemptTtlMs: 900_000 },
}

/** Create a purchase order and begin its payment; returns the order id. */
const createAndPay = async (amountPaise: number): Promise<string> => {
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
  return orderId
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
  uow = createUnitOfWork(createDatabase(pool))
  workerDeps = {
    unitOfWork: uow,
    outboxRepository,
    paymentRepository,
    orderRepository,
    investorLedgerRepository,
    notificationRepository,
    auditRepository,
    clock,
    config: { paymentProvider: "manual" },
    settleConfig: { topic: "payment", workerId: "test-worker", leaseMs: 60_000, claimLimit: 50, autoConfirm: true },
  }

  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ('worker@example.com','+14155551401','Worker User','active', now()) returning id",
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
    "insert into funds (slug, state, published_at, created_by_user_id) values ('worker-fund','published', now(), $1) returning id",
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
      "values ($1,1,'Worker Fund','equity','grow','high', 50000, 100000, $2, $3, $4, $5) returning id",
    [fundId, disclosure.rows[0]!.id, nav.rows[0]!.id, randomBytes(32), userId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, fundId])
}, 200_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("payment settlement worker (integration)", () => {
  test("a settlement pass books a paid order and materializes the holding", async () => {
    const orderId = await createAndPay(200_000) // ₹2,000 @ NAV 20 => 100 units

    const summary = await settleDuePayments(workerDeps)
    expect(summary.claimed).toBe(1)
    expect(summary.booked).toBe(1)

    const order = await pool.query<{ state: string }>("select state from investment_orders where id = $1", [orderId])
    expect(order.rows[0]?.state).toBe("booked")
    const payment = await pool.query<{ state: string }>("select state from payments where order_id = $1", [orderId])
    expect(payment.rows[0]?.state).toBe("succeeded")
    // Option B: the settled payment appears as one contribution ledger entry.
    const holding = await pool.query<{ value_delta_paise: string }>(
      "select value_delta_paise from investor_ledger_entries where user_id = $1 and fund_id = $2",
      [userId, fundId],
    )
    expect(holding.rows[0]?.value_delta_paise).toBe("200000")
    const outbox = await pool.query<{ state: string }>(
      "select state from outbox_events where topic = 'payment' and aggregate_id = (select id from payments where order_id = $1)",
      [orderId],
    )
    expect(outbox.rows[0]?.state).toBe("delivered")
  })

  test("a second pass is a no-op (the delivered event is not reclaimed)", async () => {
    const summary = await settleDuePayments(workerDeps)
    expect(summary.claimed).toBe(0)
    expect(summary.booked).toBe(0)

    // Exactly one execution exists for the previously booked order.
    const executions = await pool.query<{ c: number }>(
      "select count(*)::int as c from investor_ledger_entries where user_id = $1",
      [userId],
    )
    expect(executions.rows[0]?.c).toBe(1)
  })

  test("one pass settles multiple due payments", async () => {
    const before = await pool.query<{ c: number }>(
      "select count(*)::int as c from investment_orders where user_id = $1 and state = 'booked'",
      [userId],
    )
    await createAndPay(100_000) // 50 units
    await createAndPay(100_000) // 50 units

    const summary = await settleDuePayments(workerDeps)
    expect(summary.claimed).toBe(2)
    expect(summary.booked).toBe(2)

    const after = await pool.query<{ c: number }>(
      "select count(*)::int as c from investment_orders where user_id = $1 and state = 'booked'",
      [userId],
    )
    expect(after.rows[0]!.c).toBe(before.rows[0]!.c + 2)
  })

  test("a pass with nothing due settles nothing", async () => {
    const summary = await settleDuePayments(workerDeps)
    expect(summary).toMatchObject({ claimed: 0, booked: 0, alreadyBooked: 0, retried: 0, deadLettered: 0 })
  })

  test("a real-provider pass only dispatches (awaits webhook), it does not book", async () => {
    const orderId = await createAndPay(100_000)
    const realProviderDeps: SettleDuePaymentsDeps = {
      ...workerDeps,
      config: { paymentProvider: "razorpay" },
      settleConfig: { ...workerDeps.settleConfig, autoConfirm: false },
    }

    const summary = await settleDuePayments(realProviderDeps)
    expect(summary.dispatched).toBe(1)
    expect(summary.booked).toBe(0)

    const order = await pool.query<{ state: string }>("select state from investment_orders where id = $1", [orderId])
    expect(order.rows[0]?.state).toBe("payment_pending") // awaiting the webhook confirmation
    const payment = await pool.query<{ state: string }>("select state from payments where order_id = $1", [orderId])
    expect(payment.rows[0]?.state).toBe("provider_pending")
  })
})
