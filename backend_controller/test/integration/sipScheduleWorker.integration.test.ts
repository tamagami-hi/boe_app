import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { sql, type Kysely } from "kysely"
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
import { createSipPlanRepository, type SipPlanRepository } from "../../src/repositories/sipPlanRepository.js"
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

const runWorker = (at: Date, sipPlanRepository: SipPlanRepository = createSipPlanRepository()): Promise<SipScheduleSummary> => runSipSchedulePass({
  unitOfWork,
  clock: () => at,
  sipPlanRepository,
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

const seedDuePlan = async (userId: string, dueDate: string): Promise<string> =>
  (await pool.query<{ id: string }>(
    "insert into sip_plans (user_id, fund_id, amount_paise, debit_day, duration_months, collection_mode, state, start_date, next_due_date) " +
      "values ($1, $2, 50000, 13, 12, 'manual_checkout', 'active', '2026-11-13', $3) returning id",
    [userId, fundId, dueDate],
  )).rows[0]!.id

const seedAcceptedInstallment = async (userId: string, sipPlanId: string, duePeriod: string): Promise<void> => {
  await pool.query(
    "insert into investment_orders (user_id, fund_id, fund_version_id, sip_plan_id, type, state, amount_paise, due_period, accepted_at) " +
      "select $1, id, current_published_version_id, $2, 'sip_installment', 'accepted', 50000, $3, now() from funds where id = $4",
    [userId, sipPlanId, duePeriod, fundId],
  )
}

const listingThen = (
  change: (tx: Parameters<SipPlanRepository["listDue"]>[0]) => Promise<unknown>,
): SipPlanRepository => {
  const base = createSipPlanRepository()
  return {
    ...base,
    listDue: async (tx, input) => {
      const rows = await base.listDue(tx, input)
      await change(tx)
      return rows
    },
  }
}

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

  test("creates no order for a plan the client paused after the due list was read", async () => {
    const { userId } = await seedEligibleClient()
    const sipPlanId = await seedDuePlan(userId, "2026-11-13")
    const pausingAfterList = listingThen((tx) =>
      tx.updateTable("sip_plans").set({ state: "paused", paused_at: CREATED_AT }).where("id", "=", sipPlanId).execute())

    await runWorker(CREATED_AT, pausingAfterList)

    expect(await installmentsOf(sipPlanId)).toEqual([])
    const notifications = await pool.query("select 1 from notifications where user_id = $1", [userId])
    expect(notifications.rowCount).toBe(0)
  })

  test("writes nothing to a plan another worker advanced after the due list was read", async () => {
    const { userId } = await seedEligibleClient()
    const sipPlanId = await seedDuePlan(userId, "2026-11-13")
    await seedAcceptedInstallment(userId, sipPlanId, "2026-11-01")
    await seedAcceptedInstallment(userId, sipPlanId, "2026-12-01")
    const bumped: unknown[] = []
    const advancedElsewhere = listingThen(async (tx) => {
      bumped.push(await tx.updateTable("sip_plans").set({ next_due_date: "2027-01-13", version: sql<string>`version + 1` })
        .where("id", "=", sipPlanId).returningAll().executeTakeFirstOrThrow())
    })

    await runWorker(new Date("2026-12-20T06:00:00.000Z"), advancedElsewhere)

    const after = await database.selectFrom("sip_plans").selectAll().where("id", "=", sipPlanId).executeTakeFirstOrThrow()
    expect(after).toEqual(bumped[0])
    expect((await installmentsOf(sipPlanId)).map((order) => order.due_period)).toEqual(["2026-11-01", "2026-12-01"])
  })

  test("advances next_due_date only from the value the caller expects", async () => {
    const { userId } = await seedEligibleClient()
    const sipPlanId = await seedDuePlan(userId, "2026-11-13")
    const repository = createSipPlanRepository()
    const advance = (expectedNextDueDate: string) => unitOfWork.execute((tx) =>
      repository.advanceNextDueDate(tx, { sipPlanId, expectedNextDueDate, nextDueDate: "2026-12-13", now: CREATED_AT }))

    expect(await advance("2026-10-13")).toBeNull()
    const unchanged = await pool.query<{ next_due_date: string; version: string }>(
      "select to_char(next_due_date, 'YYYY-MM-DD') next_due_date, version::text version from sip_plans where id = $1",
      [sipPlanId],
    )
    expect(unchanged.rows[0]).toEqual({ next_due_date: "2026-11-13", version: "1" })
    expect((await advance("2026-11-13"))?.version).toBe("2")
  })
})
