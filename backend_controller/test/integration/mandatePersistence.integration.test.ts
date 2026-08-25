import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Kysely } from "kysely"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { Database } from "../../src/db/types.js"
import { createMandatesRepository } from "../../src/repositories/mandatesRepository.js"
import { createPaymentsRepository } from "../../src/repositories/paymentsRepository.js"
import { createInvestmentSettlementRepository } from "../../src/repositories/investmentSettlementRepository.js"
import { createSipPlanRepository } from "../../src/repositories/sipPlanRepository.js"
import { reconcileCollectionFact } from "../../src/domain/payments/reconcileCollectionFact.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let database: Kysely<Database>

const repository = createMandatesRepository()
const settlementRepository = createInvestmentSettlementRepository()

const randomPhone = (): string =>
  `+91${(randomBytes(8).readBigUInt64BE() % 10_000_000_000n).toString().padStart(10, "0")}`

const seedFundForUser = async (userId: string): Promise<Readonly<{ fundId: string; versionId: string }>> => {
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`fund-${randomUUID()}`, userId],
  )
  const fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions " +
      "(fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Mandate terms', 'Terms', $2, now(), $3) returning id",
    [fundId, randomBytes(32), userId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions " +
      "(fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'Mandate Fund', 'hybrid', 'Growth', 'moderate', 'moderate', 100, 100, $2, $3, $4) returning id",
    [fundId, disclosure.rows[0]!.id, randomBytes(32), userId],
  )
  return { fundId, versionId: version.rows[0]!.id }
}

const seedFund = async (): Promise<Readonly<{ userId: string; fundId: string; versionId: string }>> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Mandate Owner', 'active', now()) returning id",
    [`${randomUUID()}@example.com`, randomPhone()],
  )
  const userId = user.rows[0]!.id
  return { userId, ...(await seedFundForUser(userId)) }
}

const createPendingMandate = async (
  fixture: Readonly<{ userId: string; fundId: string }>,
  durationMonths = 12,
) => {
  const unitOfWork = createUnitOfWork(database)
  return unitOfWork.execute(async (tx) => {
    const sip = await tx
      .insertInto("sip_plans")
      .values({
        user_id: fixture.userId,
        fund_id: fixture.fundId,
        amount_paise: "50000",
        debit_day: 5,
        duration_months: durationMonths,
        state: "pending_mandate",
        collection_mode: "phonepe_autopay",
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    const mandate = await repository.createMandate(tx, {
      sipPlanId: sip.id,
      userId: fixture.userId,
      fundId: fixture.fundId,
      merchantSubscriptionId: `MS_${randomUUID()}`,
      maxAmountPaise: "50000",
    })
    return { mandate, sip }
  })
}

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
  database = createDatabase(pool)
  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
  await runMigrations(pool, await loadMigrationFiles(directory))
}, 200_000)

afterAll(async () => {
  await database.destroy()
  await container.stop()
})

describe("PhonePe AutoPay mandate persistence", () => {
  test("preserves manual SIP defaults and prevents active AutoPay without a mandate", async () => {
    const fixture = await seedFund()
    const manual = await pool.query<{ collection_mode: string }>(
      "insert into sip_plans (user_id, fund_id, amount_paise, debit_day, state) " +
        "values ($1, $2, 50000, 5, 'active') returning collection_mode",
      [fixture.userId, fixture.fundId],
    )
    expect(manual.rows[0]?.collection_mode).toBe("manual_checkout")

    await expect(
      pool.query(
        "insert into sip_plans (user_id, fund_id, amount_paise, debit_day, duration_months, state, collection_mode) " +
          "values ($1, $2, 50000, 5, 12, 'active', 'phonepe_autopay')",
        [fixture.userId, fixture.fundId],
      ),
    ).rejects.toThrow("compatible current mandate")

    const draft = await pool.query<{ id: string }>(
      "insert into sip_plans (user_id, fund_id, amount_paise, debit_day, duration_months, state, collection_mode) " +
        "values ($1, $2, 50000, 5, 12, 'draft', 'phonepe_autopay') returning id",
      [fixture.userId, fixture.fundId],
    )
    await expect(
      createUnitOfWork(database).execute((tx) =>
        repository.createMandate(tx, {
          sipPlanId: draft.rows[0]!.id,
          userId: fixture.userId,
          fundId: fixture.fundId,
          merchantSubscriptionId: `MS_${randomUUID()}`,
          maxAmountPaise: "50000",
        }),
      ),
    ).rejects.toThrow("draft phonepe_autopay SIP cannot have a current mandate")
  })

  test("scopes mandate reads and permits transaction-safe transitional states", async () => {
    const fixture = await seedFund()
    const { mandate, sip } = await createPendingMandate(fixture)
    const unitOfWork = createUnitOfWork(database)

    expect(
      await unitOfWork.execute((tx) =>
        repository.findMandateForOwner(tx, { mandateId: mandate.id, userId: randomUUID() }),
      ),
    ).toBeNull()
    expect((await unitOfWork.execute((tx) => repository.findMandateForAdmin(tx, mandate.id)))?.id).toBe(mandate.id)

    await expect(
      unitOfWork.execute((tx) =>
        repository.createMandate(tx, {
          sipPlanId: sip.id,
          userId: fixture.userId,
          fundId: fixture.fundId,
          merchantSubscriptionId: `MS_${randomUUID()}`,
          maxAmountPaise: "50000",
        }),
      ),
    ).rejects.toThrow()

    const active = await unitOfWork.execute(async (tx) => {
      return repository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        expectedVersion: mandate.version,
        expectedSipVersion: sip.version,
        fromState: "setup_pending",
        toState: "active",
        providerSubscriptionId: `PS_${randomUUID()}`,
        now: new Date(),
      })
    })
    expect(active?.mandate.state).toBe("active")

    await expect(
      unitOfWork.execute(async (tx) => {
        await tx.updateTable("payment_mandates").set({
          state: "pause_pending",
          pause_requested_at: new Date(),
        }).where("id", "=", mandate.id).execute()
        await tx.updateTable("sip_plans").set({ state: "completed", completed_at: new Date() })
          .where("id", "=", sip.id).execute()
      }),
    ).rejects.toThrow("completed phonepe_autopay SIP requires a terminal mandate")

    const maliciousPause = {
      merchantSubscriptionId: mandate.merchant_subscription_id,
      expectedVersion: active!.mandate.version,
      expectedSipVersion: active!.sip.version,
      fromState: "active" as const,
      toState: "pause_pending" as const,
      providerSubscriptionId: active!.mandate.provider_subscription_id,
      now: new Date(),
      sipToState: "completed",
    }
    const pausePending = await unitOfWork.execute((tx) =>
      repository.applyProviderMandateState(tx, maliciousPause),
    )
    expect(pausePending?.sip.state).toBe("active")

    const paused = await unitOfWork.execute((tx) =>
      repository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        expectedVersion: pausePending!.mandate.version,
        expectedSipVersion: pausePending!.sip.version,
        fromState: "pause_pending",
        toState: "paused",
        providerSubscriptionId: active!.mandate.provider_subscription_id,
        now: new Date(),
      }),
    )
    expect(paused?.mandate.state).toBe("paused")

    const rebound = await unitOfWork.execute((tx) =>
      repository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        expectedVersion: paused!.mandate.version,
        expectedSipVersion: paused!.sip.version,
        fromState: "paused",
        toState: "active",
        providerSubscriptionId: `PS_${randomUUID()}`,
        now: new Date(),
      }),
    )
    expect(rebound).toBeNull()

    await expect(
      pool.query("update payment_mandates set provider_subscription_id = $1 where id = $2", [
        `PS_${randomUUID()}`,
        mandate.id,
      ]),
    ).rejects.toThrow("cannot be rebound")

    const cancelPending = await unitOfWork.execute((tx) =>
      repository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        expectedVersion: paused!.mandate.version,
        expectedSipVersion: paused!.sip.version,
        fromState: "paused",
        toState: "cancel_pending",
        providerSubscriptionId: paused!.mandate.provider_subscription_id,
        now: new Date(),
      }),
    )
    const fallback = await unitOfWork.execute((tx) =>
      repository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        expectedVersion: cancelPending!.mandate.version,
        expectedSipVersion: cancelPending!.sip.version,
        fromState: "cancel_pending",
        toState: "paused",
        providerSubscriptionId: cancelPending!.mandate.provider_subscription_id,
        now: new Date(),
      }),
    )
    expect(fallback?.mandate.state).toBe("paused")

    const failed = await unitOfWork.execute((tx) =>
      repository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        expectedVersion: fallback!.mandate.version,
        expectedSipVersion: fallback!.sip.version,
        fromState: "paused",
        toState: "failed",
        providerSubscriptionId: fallback!.mandate.provider_subscription_id,
        failureCode: "PROVIDER_FAILED",
        now: new Date(),
      }),
    )
    expect(failed?.sip.state).toBe("mandate_failed")
  })

  test("links one collection to canonical payment truth and claims notification once", async () => {
    const fixture = await seedFund()
    const { mandate, sip } = await createPendingMandate(fixture)
    const unitOfWork = createUnitOfWork(database)
    const active = await unitOfWork.execute((tx) =>
      repository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        expectedVersion: mandate.version,
        expectedSipVersion: sip.version,
        fromState: "setup_pending",
        toState: "active",
        providerSubscriptionId: `PS_${randomUUID()}`,
        now: new Date(),
      }),
    )

    const records = await pool.query<{ order_id: string; payment_id: string; attempt_id: string }>(
      "with new_order as (" +
        "insert into investment_orders " +
        "(user_id, fund_id, fund_version_id, sip_plan_id, type, state, amount_paise, due_period) " +
        "values ($1, $2, $3, $4, 'sip_installment', 'payment_pending', 50000, '2026-09-01') returning id" +
        "), new_payment as (" +
        "insert into payments (order_id, user_id, amount_paise) " +
        "select id, $1, 50000 from new_order returning id, order_id" +
        ") insert into payment_attempts " +
        "(payment_id, user_id, attempt_number, provider, checkout_channel, merchant_order_id) " +
        "select id, $1, 1, 'phonepe', 'phonepe_autopay', $5 from new_payment " +
        "returning (select id from new_order) order_id, payment_id, id attempt_id",
      [fixture.userId, fixture.fundId, fixture.versionId, sip.id, `MCO_${randomUUID()}`],
    )
    const record = records.rows[0]!
    await expect(
      unitOfWork.execute((tx) =>
        repository.createCollectionAttempt(tx, {
          mandateId: mandate.id,
          sipPlanId: sip.id,
          userId: fixture.userId,
          fundId: fixture.fundId,
          amountPaise: "49999",
          duePeriod: "2026-09-01",
          scheduledDebitAt: new Date("2026-09-05T04:30:00.000Z"),
          notifyAt: new Date("2026-09-04T04:30:00.000Z"),
          orderId: record.order_id,
          paymentId: record.payment_id,
          paymentAttemptId: record.attempt_id,
        }),
      ),
    ).rejects.toThrow("provenance")

    const collection = await unitOfWork.execute((tx) =>
      repository.createCollectionAttempt(tx, {
        mandateId: mandate.id,
        sipPlanId: sip.id,
        userId: fixture.userId,
        fundId: fixture.fundId,
        amountPaise: "50000",
        duePeriod: "2026-09-01",
        scheduledDebitAt: new Date("2026-09-05T04:30:00.000Z"),
        notifyAt: new Date("2026-09-04T04:30:00.000Z"),
        orderId: record.order_id,
        paymentId: record.payment_id,
        paymentAttemptId: record.attempt_id,
      }),
    )

    await expect(
      unitOfWork.execute((tx) =>
        repository.createCollectionAttempt(tx, {
          mandateId: mandate.id,
          sipPlanId: sip.id,
          userId: fixture.userId,
          fundId: fixture.fundId,
          amountPaise: "50000",
          duePeriod: "2026-09-01",
          scheduledDebitAt: new Date("2026-09-05T04:30:00.000Z"),
          notifyAt: new Date("2026-09-04T04:30:00.000Z"),
          orderId: record.order_id,
          paymentId: record.payment_id,
          paymentAttemptId: record.attempt_id,
        }),
      ),
    ).rejects.toThrow()

    await expect(pool.query("update sip_plans set amount_paise = 60000 where id = $1", [sip.id])).rejects.toThrow()
    await expect(pool.query("update payment_mandates set max_amount_paise = 60000 where id = $1", [mandate.id])).rejects.toThrow()
    await expect(pool.query("update investment_orders set amount_paise = 60000 where id = $1", [record.order_id])).rejects.toThrow()
    await expect(pool.query("update payments set amount_paise = 60000 where id = $1", [record.payment_id])).rejects.toThrow()

    let releasePauseLock = (): void => undefined
    let markPauseLockAcquired = (): void => undefined
    const pauseLockReleased = new Promise<void>((resolve) => { releasePauseLock = resolve })
    const pauseLockAcquired = new Promise<void>((resolve) => { markPauseLockAcquired = resolve })
    const pause = unitOfWork.execute(async (tx) => {
      await tx.selectFrom("sip_plans").select("id").where("id", "=", sip.id).forUpdate().executeTakeFirstOrThrow()
      markPauseLockAcquired()
      await pauseLockReleased
      return repository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        expectedVersion: active!.mandate.version,
        expectedSipVersion: active!.sip.version,
        fromState: "active",
        toState: "paused",
        providerSubscriptionId: active!.mandate.provider_subscription_id,
        now: new Date(),
      })
    })
    await pauseLockAcquired
    const blockedClaim = unitOfWork.execute((tx) =>
      repository.claimCollectionNotification(tx, {
        attemptId: collection.id,
        userId: fixture.userId,
        expectedVersion: collection.version,
        fromState: "created",
        now: new Date(),
      }),
    )
    releasePauseLock()
    const paused = await pause
    expect(await blockedClaim).toBeNull()
    const resumed = await unitOfWork.execute((tx) =>
      repository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        expectedVersion: paused!.mandate.version,
        expectedSipVersion: paused!.sip.version,
        fromState: "paused",
        toState: "active",
        providerSubscriptionId: paused!.mandate.provider_subscription_id,
        now: new Date(),
      }),
    )
    expect(resumed?.sip.state).toBe("active")
    expect(resumed?.mandate.state).toBe("active")
    const claimChain = await pool.query<{
      sip_state: string
      mandate_state: string
      order_state: string
      payment_state: string
      attempt_state: string
      sip_amount: string
      mandate_amount: string
      order_amount: string
      payment_amount: string
    }>(
      "select sip.state sip_state, mandate.state mandate_state, investment_order.state order_state, " +
        "payment.state payment_state, payment_attempt.state attempt_state, sip.amount_paise sip_amount, " +
        "mandate.max_amount_paise mandate_amount, investment_order.amount_paise order_amount, " +
        "payment.amount_paise payment_amount from sip_plans sip " +
        "join payment_mandates mandate on mandate.id = $1 " +
        "join investment_orders investment_order on investment_order.id = $2 " +
        "join payments payment on payment.id = $3 " +
        "join payment_attempts payment_attempt on payment_attempt.id = $4 where sip.id = $5",
      [mandate.id, record.order_id, record.payment_id, record.attempt_id, sip.id],
    )
    expect(claimChain.rows[0]).toMatchObject({
      sip_state: "active",
      mandate_state: "active",
      order_state: "payment_pending",
      payment_state: "created",
      attempt_state: "created",
      sip_amount: "50000",
      mandate_amount: "50000",
      order_amount: "50000",
      payment_amount: "50000",
    })

    const notificationClaims = await Promise.all([
      unitOfWork.execute((tx) =>
        repository.claimCollectionNotification(tx, {
          attemptId: collection.id,
          userId: fixture.userId,
          expectedVersion: collection.version,
          fromState: "created",
          now: new Date(),
        }),
      ),
      unitOfWork.execute((tx) =>
        repository.claimCollectionNotification(tx, {
          attemptId: collection.id,
          userId: fixture.userId,
          expectedVersion: collection.version,
          fromState: "created",
          now: new Date(),
        }),
      ),
    ])
    expect(notificationClaims.filter((row) => row !== null)).toHaveLength(1)
    const notificationClaim = notificationClaims.find((row) => row !== null)!
    expect(notificationClaim.notify_state).toBe("dispatching")
    expect(
      await unitOfWork.execute((tx) =>
        repository.applyProviderNotificationOutcome(tx, {
          paymentAttemptId: randomUUID(),
          expectedVersion: notificationClaim.version,
          toState: "notified",
          now: new Date(),
        }),
      ),
    ).toBeNull()
    const notified = await unitOfWork.execute((tx) =>
      repository.applyProviderNotificationOutcome(tx, {
        paymentAttemptId: record.attempt_id,
        expectedVersion: notificationClaim.version,
        toState: "notified",
        now: new Date(),
      }),
    )
    expect(notified?.notify_state).toBe("notified")
    const paymentsRepository = createPaymentsRepository()
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const merchantOrderId = await unitOfWork.execute(async (tx) =>
      (await paymentsRepository.lockAttemptById(tx, record.attempt_id))!.merchant_order_id)
    expect(await unitOfWork.execute((tx) => reconcileCollectionFact(tx, { mandatesRepository: repository, paymentsRepository, settlementRepository }, {
      state: "FAILED",
      merchantOrderId,
      providerOrderId: "provider-order",
      merchantSubscriptionId: mandate.merchant_subscription_id,
      amountPaise: "50000",
      expiresAt,
      paymentDetails: [],
    }, new Date()))).toBe(false)
    expect(await unitOfWork.execute((tx) => reconcileCollectionFact(tx, { mandatesRepository: repository, paymentsRepository, settlementRepository }, {
      state: "COMPLETED",
      merchantOrderId,
      providerOrderId: "provider-order",
      merchantSubscriptionId: mandate.merchant_subscription_id,
      amountPaise: "50000",
      expiresAt,
      paymentDetails: [{ transactionId: "redemption-transaction", state: "COMPLETED", amountPaise: "50000", instrumentType: "UPI_AUTO_PAY" }],
    }, new Date()))).toBe(true)
    const canonical = await pool.query<{ payment_state: string; order_state: string; reviews: string }>(
      "select payment.state payment_state, investment_order.state order_state, " +
        "(select count(*) from fund_receipt_acknowledgements where order_id = investment_order.id) reviews " +
        "from payments payment join investment_orders investment_order on investment_order.id = payment.order_id " +
        "where payment.id = $1",
      [record.payment_id],
    )
    expect(canonical.rows[0]).toEqual({ payment_state: "succeeded", order_state: "accepted", reviews: "1" })
  })

  test("rejects a SIP installment anchored to a different fund", async () => {
    const fixture = await seedFund()
    const otherFund = await seedFundForUser(fixture.userId)
    const { sip } = await createPendingMandate(fixture)

    await expect(
      pool.query(
        "insert into investment_orders " +
          "(user_id, fund_id, fund_version_id, sip_plan_id, type, state, amount_paise, due_period) " +
          "values ($1, $2, $3, $4, 'sip_installment', 'payment_pending', 50000, '2026-10-01')",
        [fixture.userId, otherFund.fundId, otherFund.versionId, sip.id],
      ),
    ).rejects.toThrow("investment_orders_sip_user_fund_fk")
  })

  test("keeps AutoPay plans out of the manual scheduler repository", async () => {
    const fixture = await seedFund()
    const { sip } = await createPendingMandate(fixture)
    const manual = await pool.query<{ id: string }>(
      "insert into sip_plans " +
        "(user_id, fund_id, amount_paise, debit_day, state, next_due_date, collection_mode) " +
        "values ($1, $2, 50000, 5, 'active', '2026-08-01', 'manual_checkout') returning id",
      [fixture.userId, fixture.fundId],
    )
    const due = await createUnitOfWork(database).execute((tx) =>
      createSipPlanRepository().listDue(tx, { asOf: "2026-08-31", limit: 20 }),
    )
    expect(due.map((row) => row.id)).toContain(manual.rows[0]!.id)
    expect(due.map((row) => row.id)).not.toContain(sip.id)
  })

  test("completes a one-installment SIP only after provider mandate cancellation", async () => {
    const fixture = await seedFund()
    const { mandate, sip } = await createPendingMandate(fixture, 1)
    const unitOfWork = createUnitOfWork(database)
    const active = await unitOfWork.execute((tx) => repository.applyProviderMandateState(tx, {
      merchantSubscriptionId: mandate.merchant_subscription_id,
      expectedVersion: mandate.version,
      expectedSipVersion: sip.version,
      fromState: "setup_pending",
      toState: "active",
      providerSubscriptionId: `PS_${randomUUID()}`,
      now: new Date(),
    }))
    expect(active?.sip.next_due_date).toBeNull()
    await pool.query(
      "insert into investment_orders " +
        "(user_id, fund_id, fund_version_id, sip_plan_id, type, state, amount_paise, due_period, accepted_at) " +
        "values ($1, $2, $3, $4, 'sip_installment', 'accepted', 50000, date_trunc('month', now())::date, now())",
      [fixture.userId, fixture.fundId, fixture.versionId, sip.id],
    )
    expect(await unitOfWork.execute((tx) => repository.requestTermCompletion(tx, { sipPlanId: sip.id, now: new Date() }))).toBe(true)
    const pending = await unitOfWork.execute((tx) => repository.findMandateForAdmin(tx, mandate.id))
    const pendingSip = await unitOfWork.execute((tx) => createSipPlanRepository().lockById(tx, { sipPlanId: sip.id, userId: fixture.userId }))
    expect(pending?.state).toBe("cancel_pending")
    expect(pendingSip?.state).toBe("cancel_pending")
    const completed = await unitOfWork.execute((tx) => repository.applyProviderMandateState(tx, {
      merchantSubscriptionId: mandate.merchant_subscription_id,
      expectedVersion: pending!.version,
      expectedSipVersion: pendingSip!.version,
      fromState: "cancel_pending",
      toState: "cancelled",
      providerSubscriptionId: pending!.provider_subscription_id,
      now: new Date(),
    }))
    expect(completed?.mandate.state).toBe("cancelled")
    expect(completed?.sip.state).toBe("completed")
  })
})
