import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { Kysely } from "kysely"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import { createDatabase, createUnitOfWork, type UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { Database } from "../../src/db/types.js"
import type { PaymentGateway } from "../../src/providers/paymentGateway.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createPaymentsRepository } from "../../src/repositories/paymentsRepository.js"
import { createSipPlanRepository } from "../../src/repositories/sipPlanRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerClientOrderRoutes } from "../../src/routes/clientOrderRoutes.js"
import { registerClientSipPlanRoutes } from "../../src/routes/clientSipPlanRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"
import { runSipSchedulePass } from "../../src/sipScheduleWorker.js"

const WRITE_TABLES = ["investment_orders", "sip_plans", "audit_events", "notifications", "idempotency_records"] as const
type TableCounts = Readonly<Record<(typeof WRITE_TABLES)[number], number>>

const unusedGateway: PaymentGateway = {
  createCheckout: () => Promise.reject(new Error("unused")),
  getOrderStatus: () => Promise.reject(new Error("unused")),
  initiateRefund: () => Promise.reject(new Error("unused")),
  getRefundStatus: () => Promise.reject(new Error("unused")),
}

let container: StartedPostgreSqlContainer
let pool: Pool
let database: Kysely<Database>
let unitOfWork: UnitOfWork
let accessTokenService: AccessTokenService
let paymentsOffApp: FastifyInstance
let paymentsOnApp: FastifyInstance
let fundId: string

const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data

const randomPhone = (): string => `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`

const countRows = async (): Promise<TableCounts> => {
  const entries = await Promise.all(WRITE_TABLES.map(async (table) => {
    const result = await pool.query<{ count: string }>(`select count(*)::text as count from ${table}`)
    return [table, Number(result.rows[0]!.count)] as const
  }))
  return Object.fromEntries(entries) as TableCounts
}

const seedEligibleClient = async (): Promise<{ userId: string; token: string }> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, " +
      "email_verification_state, email_verified_at) values ($1, $2, 'Client Person', 'active', now(), 'verified', now()) returning id",
    [`payments-off-${randomUUID().slice(0, 8)}@example.com`, randomPhone()],
  )
  const userId = user.rows[0]!.id
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [userId],
  )
  return { userId, token: await accessTokenService.sign({ sub: userId, sid: session.rows[0]!.id }) }
}

const seedPublishedFund = async (): Promise<string> => {
  const actor = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Fund Author', 'active', now()) returning id",
    [`payments-off-author-${randomUUID().slice(0, 8)}@example.com`, randomPhone()],
  )
  const actorId = actor.rows[0]!.id
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`payments-off-${randomUUID().slice(0, 8)}`, actorId],
  )
  const id = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [id, randomBytes(32), actorId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
      "minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, " +
      "terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'Payments Off Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4) returning id",
    [id, disclosure.rows[0]!.id, randomBytes(32), actorId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, id])
  return id
}

const buildApp = (paymentGateway: PaymentGateway | null): FastifyInstance =>
  createApplication({
    logger: false,
    registerRoutes: (instance) => {
      const shared = {
        accessTokenService,
        database,
        clientWeb: { originAllowlist: [] },
        unitOfWork,
        clock: () => new Date(),
        orderRepository: createOrderRepository(),
        userRepository: createUserRepository(),
        auditRepository: createAuditRepository(),
        paymentGateway,
      }
      registerClientOrderRoutes(instance, {
        ...shared,
        idempotencyRepository: createIdempotencyRepository(),
        paymentsRepository: createPaymentsRepository(),
        config: { idempotencyTtlMs: 86_400_000, attemptTtlMs: 900_000, merchantService: "boe-dev" },
      })
      registerClientSipPlanRoutes(instance, {
        ...shared,
        sipPlanRepository: createSipPlanRepository(),
        notificationRepository: createNotificationRepository(),
      })
    },
  })

const createOrderRequest = (token: string, idempotencyKey: string) => ({
  method: "POST" as const,
  url: "/v1/client/orders",
  headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
  payload: { fundId, amountPaise: "1000000" },
})

const createSipRequest = (token: string) => ({
  method: "POST" as const,
  url: "/v1/client/sips",
  headers: { authorization: `Bearer ${token}` },
  payload: { fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
})

const runWorkerWithoutGateway = () => runSipSchedulePass({
  unitOfWork,
  clock: () => new Date(),
  sipPlanRepository: createSipPlanRepository(),
  orderRepository: createOrderRepository(),
  userRepository: createUserRepository(),
  auditRepository: createAuditRepository(),
  notificationRepository: createNotificationRepository(),
  config: { claimLimit: 200, maxPeriodsPerPlan: 24, gatewayConfigured: false },
})

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
  await runMigrations(pool, await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url))))
  await runSeed(pool)
  database = createDatabase(pool)
  unitOfWork = createUnitOfWork(database)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })
  fundId = await seedPublishedFund()
  paymentsOffApp = buildApp(null)
  paymentsOnApp = buildApp(unusedGateway)
}, 220_000)

afterAll(async () => {
  await paymentsOffApp?.close()
  await paymentsOnApp?.close()
  await pool?.end()
  await container?.stop()
})

describe("client investing while no payment gateway is configured", () => {
  test("refuses a lump-sum order with DEPENDENCY_UNAVAILABLE and writes nothing", async () => {
    const { token } = await seedEligibleClient()
    const before = await countRows()

    const response = await paymentsOffApp.inject(createOrderRequest(token, `off-order-${randomUUID()}`))

    expect(response.statusCode).toBe(503)
    expect(errorOf(response)).toBe("DEPENDENCY_UNAVAILABLE")
    expect(await countRows()).toEqual(before)
  })

  test("refuses a SIP plan with DEPENDENCY_UNAVAILABLE and writes nothing", async () => {
    const { token } = await seedEligibleClient()
    const before = await countRows()

    const response = await paymentsOffApp.inject(createSipRequest(token))

    expect(response.statusCode).toBe(503)
    expect(errorOf(response)).toBe("DEPENDENCY_UNAVAILABLE")
    expect(await countRows()).toEqual(before)
  })

  test("still replays an order that was created while the gateway was configured", async () => {
    const { token } = await seedEligibleClient()
    const key = `replay-order-${randomUUID()}`
    const created = await paymentsOnApp.inject(createOrderRequest(token, key))
    expect(created.statusCode, created.body).toBe(201)
    const before = await countRows()

    const replayed = await paymentsOffApp.inject(createOrderRequest(token, key))

    expect(replayed.statusCode, replayed.body).toBe(201)
    expect(dataOf<{ orderId: string }>(replayed).orderId).toBe(dataOf<{ orderId: string }>(created).orderId)
    expect(await countRows()).toEqual(before)
  })

  test("creates the order and the SIP plan as before when a payment gateway is configured", async () => {
    const { userId, token } = await seedEligibleClient()

    const order = await paymentsOnApp.inject(createOrderRequest(token, `on-order-${randomUUID()}`))
    const sip = await paymentsOnApp.inject(createSipRequest(token))

    expect(order.statusCode, order.body).toBe(201)
    expect(sip.statusCode, sip.body).toBe(201)
    const orders = await pool.query<{ type: string }>(
      "select type from investment_orders where user_id = $1 order by type", [userId],
    )
    expect(orders.rows.map((row) => row.type)).toEqual(["lump_sum", "sip_installment"])
    const notifications = await pool.query("select 1 from notifications where user_id = $1 and kind = 'sip_installment_due'", [userId])
    expect(notifications.rowCount).toBe(1)
  })
})

describe("SIP schedule worker while no payment gateway is configured", () => {
  test("creates no instalment order and no notification for a due plan", async () => {
    const { userId } = await seedEligibleClient()
    const dueDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const plan = await pool.query<{ id: string }>(
      "insert into sip_plans (user_id, fund_id, amount_paise, debit_day, duration_months, collection_mode, state, start_date, next_due_date) " +
        "values ($1, $2, 50000, 1, 12, 'manual_checkout', 'active', $3, $3) returning *",
      [userId, fundId, dueDate],
    )
    const before = await countRows()

    const summary = await runWorkerWithoutGateway()

    expect(summary.installmentsCreated).toBe(0)
    expect(await countRows()).toEqual(before)
    const planAfter = await pool.query("select * from sip_plans where id = $1", [plan.rows[0]!.id])
    expect(planAfter.rows).toEqual(plan.rows)
  })
})
