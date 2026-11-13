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
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createSipPlanRepository } from "../../src/repositories/sipPlanRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerClientSipPlanRoutes } from "../../src/routes/clientSipPlanRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"
import { runSipSchedulePass, type SipScheduleSummary } from "../../src/sipScheduleWorker.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const CREATED_AT = new Date("2026-11-13T06:00:00.000Z")

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
let app: FastifyInstance
let fundId: string

const randomPhone = (): string => `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`

const seedEligibleClient = async (): Promise<{ userId: string; token: string }> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, " +
      "email_verification_state, email_verified_at) values ($1, $2, 'Client Person', 'active', now(), 'verified', now()) returning id",
    [`sip-worker-${randomUUID().slice(0, 8)}@example.com`, randomPhone()],
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
    [`sip-worker-author-${randomUUID().slice(0, 8)}@example.com`, randomPhone()],
  )
  const actorId = actor.rows[0]!.id
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`sip-worker-${randomUUID().slice(0, 8)}`, actorId],
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
      "values ($1, 1, 'Schedule Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4) returning id",
    [id, disclosure.rows[0]!.id, randomBytes(32), actorId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, id])
  return id
}

const runWorker = (at: Date): Promise<SipScheduleSummary> => runSipSchedulePass({
  unitOfWork,
  clock: () => at,
  sipPlanRepository: createSipPlanRepository(),
  orderRepository: createOrderRepository(),
  userRepository: createUserRepository(),
  auditRepository: createAuditRepository(),
  notificationRepository: createNotificationRepository(),
  config: { claimLimit: 200, maxPeriodsPerPlan: 24, gatewayConfigured: true },
})

const installmentsOf = async (sipPlanId: string): Promise<{ id: string; due_period: string; state: string }[]> =>
  (await pool.query<{ id: string; due_period: string; state: string }>(
    "select id, to_char(due_period, 'YYYY-MM-DD') due_period, state from investment_orders " +
      "where sip_plan_id = $1 and type = 'sip_installment' order by due_period",
    [sipPlanId],
  )).rows

const acceptOrder = async (orderId: string): Promise<void> => {
  await pool.query("update investment_orders set state = 'accepted', accepted_at = now() where id = $1", [orderId])
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
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerClientSipPlanRoutes(instance, {
        accessTokenService,
        database,
        clientWeb: { originAllowlist: [] },
        unitOfWork,
        clock: () => CREATED_AT,
        sipPlanRepository: createSipPlanRepository(),
        orderRepository: createOrderRepository(),
        userRepository: createUserRepository(),
        auditRepository: createAuditRepository(),
        notificationRepository: createNotificationRepository(),
        paymentGateway: unusedGateway,
      })
    },
  })
}, 220_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("SIP schedule worker on PostgreSQL", () => {
  test("creates a due plan's instalment order and audits it under a uuid request id", async () => {
    const { userId } = await seedEligibleClient()
    const plan = await pool.query<{ id: string }>(
      "insert into sip_plans (user_id, fund_id, amount_paise, debit_day, duration_months, collection_mode, state, start_date, next_due_date) " +
        "values ($1, $2, 50000, 13, 12, 'manual_checkout', 'active', '2026-11-13', '2026-11-13') returning id",
      [userId, fundId],
    )
    const sipPlanId = plan.rows[0]!.id

    const summary = await runWorker(CREATED_AT)

    expect(summary.installmentsCreated).toBe(1)
    const orders = await installmentsOf(sipPlanId)
    expect(orders).toHaveLength(1)
    const audit = await pool.query<{ request_id: string }>(
      "select request_id::text request_id from audit_events where command = 'sip.installment_order.create' and entity_id = $1",
      [orders[0]!.id],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]!.request_id).toMatch(UUID_PATTERN)
  })

  test("keeps one order for the month a client SIP was created in, then one for the next month", async () => {
    const { userId, token } = await seedEligibleClient()
    const created = await app.inject({
      method: "POST",
      url: "/v1/client/sips",
      headers: { authorization: `Bearer ${token}` },
      payload: { fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
    })
    expect(created.statusCode, created.body).toBe(201)
    const sipPlanId = created.json<{ data: { sipId: string } }>().data.sipId

    await runWorker(CREATED_AT)
    await runWorker(CREATED_AT)

    const firstMonth = await installmentsOf(sipPlanId)
    expect(firstMonth.map((order) => order.due_period)).toEqual(["2026-11-01"])

    await acceptOrder(firstMonth[0]!.id)
    await runWorker(new Date("2026-12-05T06:00:00.000Z"))
    await runWorker(new Date("2026-12-05T06:00:00.000Z"))

    const bothMonths = await installmentsOf(sipPlanId)
    expect(bothMonths.map((order) => order.due_period)).toEqual(["2026-11-01", "2026-12-01"])
    const plan = await pool.query<{ next_due_date: string }>(
      "select to_char(next_due_date, 'YYYY-MM-DD') next_due_date from sip_plans where id = $1 and user_id = $2",
      [sipPlanId, userId],
    )
    expect(plan.rows[0]!.next_due_date).toBe("2026-12-05")
  })

  test("moves a plan past a failed month without a new order for that month", async () => {
    const { userId } = await seedEligibleClient()
    const plan = await pool.query<{ id: string }>(
      "insert into sip_plans (user_id, fund_id, amount_paise, debit_day, duration_months, collection_mode, state, start_date, next_due_date) " +
        "values ($1, $2, 50000, 13, 12, 'manual_checkout', 'active', '2026-11-13', '2026-11-13') returning id",
      [userId, fundId],
    )
    const sipPlanId = plan.rows[0]!.id
    await runWorker(CREATED_AT)
    const [november] = await installmentsOf(sipPlanId)
    await pool.query(
      "update investment_orders set state = 'payment_failed', failure_code = 'PROVIDER_DECLINED' where id = $1",
      [november!.id],
    )
    const failedRow = (await pool.query("select * from investment_orders where id = $1", [november!.id])).rows

    await runWorker(new Date("2026-11-20T06:00:00.000Z"))
    await runWorker(new Date("2026-12-13T06:00:00.000Z"))
    await runWorker(new Date("2026-12-13T06:00:00.000Z"))

    const orders = await installmentsOf(sipPlanId)
    expect(orders.map((order) => [order.due_period, order.state])).toEqual([
      ["2026-11-01", "payment_failed"],
      ["2026-12-01", "submitted"],
    ])
    expect((await pool.query("select * from investment_orders where id = $1", [november!.id])).rows).toEqual(failedRow)
  })
})
