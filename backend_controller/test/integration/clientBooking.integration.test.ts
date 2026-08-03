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
import { bookOrder } from "../../src/domain/client/bookOrder.js"
import { confirmPayment, sendPaymentToProvider } from "../../src/domain/client/confirmPayment.js"
import { createOrder } from "../../src/domain/client/createOrder.js"
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
const seamDeps = { paymentRepository, orderRepository, auditRepository, clock }
const bookDeps = { orderRepository, investorLedgerRepository, notificationRepository, auditRepository, clock }

/** Drive an order through the full lifecycle to `booked`; returns the order id. */
const runFullChain = async (amountPaise: number): Promise<string> => {
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
  await uow.execute((tx) =>
    sendPaymentToProvider(tx, seamDeps, {
      userId,
      orderId,
      providerPaymentId: `manual:${orderId}`,
      requestId: randomUUID(),
    }),
  )
  await uow.execute((tx) =>
    confirmPayment(tx, seamDeps, {
      userId,
      orderId,
      evidenceAmountPaise: String(amountPaise),
      evidenceCurrency: "INR",
      requestId: randomUUID(),
    }),
  )
  await uow.execute((tx) => bookOrder(tx, bookDeps, { userId, orderId, requestId: randomUUID() }))
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

  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ('book@example.com','+14155551301','Book User','active', now()) returning id",
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
    "insert into funds (slug, state, published_at, created_by_user_id) values ('book-fund','published', now(), $1) returning id",
    [userId],
  )
  fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1,1,'D','b',$2, now(), $3) returning id",
    [fundId, randomBytes(32), userId],
  )
  // NAV 20.00 so that ₹X / 20 is easy to verify.
  const nav = await pool.query<{ id: string }>(
    "insert into fund_nav_prices (fund_id, nav, as_of_date, revision, published_by_user_id) " +
      "values ($1, 20.00000000, current_date, 1, $2) returning id",
    [fundId, userId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, initial_nav_price_id, terms_sha256, created_by_user_id) " +
      "values ($1,1,'Book Fund','equity','grow','high', 50000, 100000, $2, $3, $4, $5) returning id",
    [fundId, disclosure.rows[0]!.id, nav.rows[0]!.id, randomBytes(32), userId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, fundId])
}, 200_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("order booking into the investor ledger (integration)", () => {
  test("a full create->pay->confirm->book chain appends one contribution entry", async () => {
    // Option B: ₹2,000 received becomes ₹2,000 of invested principal and ₹2,000 of
    // current value. There is no unit quantity and no price.
    const orderId = await runFullChain(200_000)

    const order = await pool.query<{ state: string; booked_at: string | null }>(
      "select state, booked_at from investment_orders where id = $1",
      [orderId],
    )
    expect(order.rows[0]?.state).toBe("booked")
    expect(order.rows[0]?.booked_at).not.toBeNull()

    const entry = await pool.query<{
      entry_type: string
      principal_delta_paise: string
      value_delta_paise: string
      amount_paise: string
      effective_date: string
      payment_id: string | null
      allocated_by_user_id: string | null
    }>(
      "select entry_type, principal_delta_paise, value_delta_paise, amount_paise, " +
        "effective_date::text as effective_date, payment_id, allocated_by_user_id " +
        "from investor_ledger_entries where order_id = $1",
      [orderId],
    )
    expect(entry.rows).toHaveLength(1)
    expect(entry.rows[0]).toMatchObject({
      entry_type: "lump_sum",
      principal_delta_paise: "200000",
      value_delta_paise: "200000",
      amount_paise: "200000",
      // A contribution is never administrator-originated.
      allocated_by_user_id: null,
    })

    // The unit-era tables stay untouched by the money model.
    const legacy = await pool.query<{ executions: number; holdings: number; lots: number }>(
      "select (select count(*)::int from investment_executions where order_id = $1) as executions, " +
        "(select count(*)::int from holdings where user_id = $2) as holdings, " +
        "(select count(*)::int from holding_lots where user_id = $2) as lots",
      [orderId, userId],
    )
    expect(legacy.rows[0]).toEqual({ executions: 0, holdings: 0, lots: 0 })

    const payment = await pool.query<{ state: string }>("select state from payments where order_id = $1", [orderId])
    expect(payment.rows[0]?.state).toBe("succeeded")
    const notification = await pool.query<{ c: number }>(
      "select count(*)::int as c from notifications where user_id = $1 and kind = 'order_booked'",
      [userId],
    )
    expect(notification.rows[0]?.c).toBeGreaterThanOrEqual(1)
  })

  test("a second contribution adds another dated entry rather than mutating a balance", async () => {
    const before = await pool.query<{ entries: number; principal: string }>(
      "select count(*)::int as entries, coalesce(sum(principal_delta_paise),0)::text as principal " +
        "from investor_ledger_entries where user_id = $1 and fund_id = $2",
      [userId, fundId],
    )
    const beforeEntries = Number(before.rows[0]?.entries)
    const beforePrincipal = BigInt(before.rows[0]?.principal ?? "0")

    await runFullChain(100_000)

    const after = await pool.query<{ entries: number; principal: string; value: string }>(
      "select count(*)::int as entries, coalesce(sum(principal_delta_paise),0)::text as principal, " +
        "coalesce(sum(value_delta_paise),0)::text as value " +
        "from investor_ledger_entries where user_id = $1 and fund_id = $2",
      [userId, fundId],
    )
    expect(Number(after.rows[0]?.entries)).toBe(beforeEntries + 1)
    expect(BigInt(after.rows[0]?.principal ?? "0")).toBe(beforePrincipal + 100_000n)
    // Total Investment and Current Value move together for contributions.
    expect(after.rows[0]?.value).toBe(after.rows[0]?.principal)
  })

  test("booking a payment_pending order is rejected (STATE_CONFLICT)", async () => {
    const orderId = await uow.execute(async (tx) => {
      const order = await createOrder(tx, createDeps, {
        userId,
        fundId,
        amountPaise: "200000",
        requestId: randomUUID(),
      })
      return order.id
    })
    await uow.execute((tx) => beginPayment(tx, beginDeps, { userId, orderId, requestId: randomUUID() }))

    await expect(
      uow.execute((tx) => bookOrder(tx, bookDeps, { userId, orderId, requestId: randomUUID() })),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" })
  })

  test("confirmPayment with mismatched provider evidence is rejected", async () => {
    const orderId = await uow.execute(async (tx) => {
      const order = await createOrder(tx, createDeps, {
        userId,
        fundId,
        amountPaise: "200000",
        requestId: randomUUID(),
      })
      return order.id
    })
    await uow.execute((tx) => beginPayment(tx, beginDeps, { userId, orderId, requestId: randomUUID() }))
    await uow.execute((tx) =>
      sendPaymentToProvider(tx, seamDeps, { userId, orderId, providerPaymentId: `manual:${orderId}`, requestId: randomUUID() }),
    )
    await expect(
      uow.execute((tx) =>
        confirmPayment(tx, seamDeps, {
          userId,
          orderId,
          evidenceAmountPaise: "199999",
          evidenceCurrency: "INR",
          requestId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" })
  })

  test("double booking the same order is rejected (no second ledger entry)", async () => {
    const orderId = await runFullChain(200_000)
    await expect(
      uow.execute((tx) => bookOrder(tx, bookDeps, { userId, orderId, requestId: randomUUID() })),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" })

    const executions = await pool.query<{ c: number }>(
      "select count(*)::int as c from investor_ledger_entries where order_id = $1",
      [orderId],
    )
    expect(executions.rows[0]?.c).toBe(1)
  })
})
