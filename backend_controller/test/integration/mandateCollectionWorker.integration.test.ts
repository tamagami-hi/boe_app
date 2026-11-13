import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Kysely } from "kysely"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork, type UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { Database } from "../../src/db/types.js"
import { runMandateCollectionPass, type MandateCollectionSummary } from "../../src/mandateCollectionWorker.js"
import type {
  CollectionStatus,
  NotifyCollectionCommand,
  RecurringPaymentGateway,
} from "../../src/providers/recurringPaymentGateway.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createInvestmentSettlementRepository } from "../../src/repositories/investmentSettlementRepository.js"
import { createMandatesRepository } from "../../src/repositories/mandatesRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createPaymentsRepository } from "../../src/repositories/paymentsRepository.js"
import { createSipPlanRepository } from "../../src/repositories/sipPlanRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const AMOUNT_PAISE = "50000"

interface AutoPayPlan {
  readonly userId: string
  readonly sipPlanId: string
  readonly merchantSubscriptionId: string
}

interface NotifiedCollection {
  readonly command: NotifyCollectionCommand
  readonly state: CollectionStatus["state"]
}

let container: StartedPostgreSqlContainer
let pool: Pool
let database: Kysely<Database>
let unitOfWork: UnitOfWork
let fundId: string

const providerSubscriptions = new Map<string, string>()
const notified = new Map<string, NotifiedCollection>()

const fakeGateway: RecurringPaymentGateway = {
  createMandateCheckout: () => Promise.reject(new Error("unused")),
  getSetupOrderStatus: () => Promise.reject(new Error("unused")),
  cancelMandate: () => Promise.reject(new Error("unused")),
  getMandateStatus: async (merchantSubscriptionId) => ({
    state: "ACTIVE",
    merchantSubscriptionId,
    providerSubscriptionId: providerSubscriptions.get(merchantSubscriptionId) ?? null,
  }),
  notifyCollection: async (command) => {
    notified.set(command.merchantOrderId, { command, state: "NOTIFIED" })
    return { providerOrderId: `PO_${command.merchantOrderId}`, providerState: "NOTIFICATION_IN_PROGRESS", expiresAt: command.expireAt }
  },
  getCollectionStatus: async (merchantOrderId) => {
    const entry = notified.get(merchantOrderId)
    if (entry === undefined) throw new Error("unknown collection")
    return {
      state: entry.state,
      merchantOrderId,
      providerOrderId: `PO_${merchantOrderId}`,
      merchantSubscriptionId: entry.command.merchantSubscriptionId,
      amountPaise: entry.command.amountPaise,
      expiresAt: entry.command.expireAt,
      paymentDetails: entry.state === "COMPLETED"
        ? [{ transactionId: `TX_${merchantOrderId}`, state: "COMPLETED", amountPaise: entry.command.amountPaise, instrumentType: "UPI_AUTO_PAY" }]
        : [],
    }
  },
}

const settleCollectionsOf = (plan: AutoPayPlan, state: "COMPLETED" | "FAILED"): void => {
  for (const [merchantOrderId, entry] of notified) {
    if (entry.state === "NOTIFIED" && entry.command.merchantSubscriptionId === plan.merchantSubscriptionId) {
      notified.set(merchantOrderId, { ...entry, state })
    }
  }
}

const notifiedCountOf = (plan: AutoPayPlan): number =>
  [...notified.values()].filter((entry) => entry.command.merchantSubscriptionId === plan.merchantSubscriptionId).length

const runPass = (at: Date): Promise<MandateCollectionSummary> => runMandateCollectionPass({
  unitOfWork,
  clock: () => at,
  recurringPaymentGateway: fakeGateway,
  sipPlanRepository: createSipPlanRepository(),
  mandatesRepository: createMandatesRepository(),
  orderRepository: createOrderRepository(),
  paymentsRepository: createPaymentsRepository(),
  settlementRepository: createInvestmentSettlementRepository(),
  userRepository: createUserRepository(),
  auditRepository: createAuditRepository(),
  notificationRepository: createNotificationRepository(),
  logger: null,
  config: { merchantService: "boe-dev", claimLimit: 100, commandEnabled: true, expiryGraceMs: 300_000 },
})

const inNotifyWindow = (month: string): Date => new Date(`${month}-04T12:00:00.000Z`)
const afterDebit = (month: string): Date => new Date(`${month}-05T12:00:00.000Z`)

const randomPhone = (): string => `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`

const seedPublishedFund = async (): Promise<string> => {
  const actor = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Fund Author', 'active', now()) returning id",
    [`autopay-author-${randomUUID().slice(0, 8)}@example.com`, randomPhone()],
  )
  const actorId = actor.rows[0]!.id
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`autopay-worker-${randomUUID().slice(0, 8)}`, actorId],
  )
  const id = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Mandate terms', 'Terms body.', $2, now(), $3) returning id",
    [id, randomBytes(32), actorId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
      "minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'AutoPay Fund', 'hybrid', 'Growth', 'moderate', 'moderate', 100, 100, $2, $3, $4) returning id",
    [id, disclosure.rows[0]!.id, randomBytes(32), actorId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, id])
  return id
}

const seedActiveAutoPayPlan = async (startDate: string): Promise<AutoPayPlan> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, " +
      "email_verification_state, email_verified_at) values ($1, $2, 'Mandate Owner', 'active', now(), 'verified', now()) returning id",
    [`autopay-${randomUUID().slice(0, 8)}@example.com`, randomPhone()],
  )
  const userId = user.rows[0]!.id
  const merchantSubscriptionId = `MS_${randomUUID()}`
  const providerSubscriptionId = `PS_${randomUUID()}`
  const repository = createMandatesRepository()
  const sipPlanId = await unitOfWork.execute(async (tx) => {
    const sip = await tx.insertInto("sip_plans").values({
      user_id: userId,
      fund_id: fundId,
      amount_paise: AMOUNT_PAISE,
      debit_day: 5,
      duration_months: 12,
      state: "pending_mandate",
      collection_mode: "phonepe_autopay",
      start_date: startDate,
    }).returningAll().executeTakeFirstOrThrow()
    const mandate = await repository.createMandate(tx, {
      sipPlanId: sip.id,
      userId,
      fundId,
      merchantSubscriptionId,
      maxAmountPaise: AMOUNT_PAISE,
    })
    const activated = await repository.applyProviderMandateState(tx, {
      merchantSubscriptionId,
      providerSubscriptionId,
      expectedVersion: mandate.version,
      expectedSipVersion: sip.version,
      fromState: "setup_pending",
      toState: "active",
      now: new Date(),
    })
    if (activated === null) throw new Error("mandate activation failed")
    return sip.id
  })
  providerSubscriptions.set(merchantSubscriptionId, providerSubscriptionId)
  return { userId, sipPlanId, merchantSubscriptionId }
}

const installmentsOf = async (sipPlanId: string): Promise<{ id: string; due_period: string; state: string }[]> =>
  (await pool.query<{ id: string; due_period: string; state: string }>(
    "select id, to_char(due_period, 'YYYY-MM-DD') due_period, state::text state from investment_orders " +
      "where sip_plan_id = $1 and type = 'sip_installment' order by due_period",
    [sipPlanId],
  )).rows

const collectionPeriodsOf = async (sipPlanId: string): Promise<string[]> =>
  (await pool.query<{ due_period: string }>(
    "select to_char(due_period, 'YYYY-MM-DD') due_period from mandate_collection_attempts where sip_plan_id = $1 order by due_period",
    [sipPlanId],
  )).rows.map((row) => row.due_period)

const nextDueDateOf = async (plan: AutoPayPlan): Promise<string | null> =>
  (await pool.query<{ next_due_date: string | null }>(
    "select to_char(next_due_date, 'YYYY-MM-DD') next_due_date from sip_plans where id = $1 and user_id = $2",
    [plan.sipPlanId, plan.userId],
  )).rows[0]!.next_due_date

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({
    connectionString: container.getConnectionUri(),
    poolMax: 8,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
  })
  await runMigrations(pool, await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url))))
  database = createDatabase(pool)
  unitOfWork = createUnitOfWork(database)
  fundId = await seedPublishedFund()
}, 220_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("AutoPay mandate collection worker on PostgreSQL", () => {
  test("creates and dispatches the due period's collection with a uuid audit request id", async () => {
    const plan = await seedActiveAutoPayPlan("2026-01-10")

    await runPass(inNotifyWindow("2026-02"))

    const orders = await installmentsOf(plan.sipPlanId)
    expect(orders).toEqual([{ id: orders[0]?.id, due_period: "2026-02-01", state: "payment_pending" }])
    expect(await collectionPeriodsOf(plan.sipPlanId)).toEqual(["2026-02-01"])
    expect(notifiedCountOf(plan)).toBe(1)
    const audit = await pool.query<{ request_id: string }>(
      "select request_id::text request_id from audit_events where command = 'sip.installment_order.create' and entity_id = $1",
      [orders[0]!.id],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]!.request_id).toMatch(UUID_PATTERN)
  })

  test("collects month 1, month 2 and month 3 across passes, once per period", async () => {
    const plan = await seedActiveAutoPayPlan("2027-01-10")

    for (const month of ["2027-02", "2027-03", "2027-04"]) {
      await runPass(inNotifyWindow(month))
      await runPass(inNotifyWindow(month))
      settleCollectionsOf(plan, "COMPLETED")
      await runPass(afterDebit(month))
      await runPass(afterDebit(month))
    }

    const orders = await installmentsOf(plan.sipPlanId)
    expect(orders.map((order) => [order.due_period, order.state])).toEqual([
      ["2027-02-01", "accepted"],
      ["2027-03-01", "accepted"],
      ["2027-04-01", "accepted"],
    ])
    expect(await collectionPeriodsOf(plan.sipPlanId)).toEqual(["2027-02-01", "2027-03-01", "2027-04-01"])
    expect(notifiedCountOf(plan)).toBe(3)
    expect(await nextDueDateOf(plan)).toBe("2027-05-05")
  })
})
