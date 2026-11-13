import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork, type UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { newMerchantOrderId } from "../../src/domain/payments/merchantIds.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createPaymentsRepository } from "../../src/repositories/paymentsRepository.js"
import { composePaymentReconciliationWorker } from "../../src/runtime/workerComposition.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const GRACE_SECONDS = 600
const MINUTE_MS = 60_000
const AMOUNT_PAISE = "1000000"

type Kind =
  | "staleUndispatched"
  | "withinGrace"
  | "withinExpiry"
  | "staleDispatched"
  | "staleDispatchStarted"
  | "staleWithLiveSibling"
  | "settled"

interface Seeded {
  readonly orderId: string
  readonly paymentId: string
  readonly attemptId: string
}

let container: StartedPostgreSqlContainer
let pool: Pool
let unitOfWork: UnitOfWork
let userId: string
let fundId: string
let fundVersionId: string

const paymentsRepository = createPaymentsRepository()
const orderRepository = createOrderRepository()
const base64Key = (): string => randomBytes(32).toString("base64")

const workerEnv = (extra: Readonly<Record<string, string>> = {}): Record<string, string> => {
  const keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" })
  return {
    DATABASE_URL: container.getConnectionUri(),
    CRYPTO_TOKEN_HASH_KEY: base64Key(),
    CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
    CRYPTO_CONSENT_IP_HMAC_KEY: base64Key(),
    CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
    CRYPTO_RECIPIENT_HMAC_KEY: base64Key(),
    CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
    CRYPTO_RECIPIENT_ENC_KEY: base64Key(),
    CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
    ACCESS_TOKEN_ISSUER: "https://test.example",
    ACCESS_TOKEN_AUDIENCE: "boe-test",
    ACCESS_TOKEN_CURRENT_KID: "k1",
    ACCESS_TOKEN_SIGNING_KEY: keyPair.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    ACCESS_TOKEN_VERIFICATION_KEYS: JSON.stringify({
      k1: keyPair.publicKey.export({ type: "spki", format: "pem" }) as string,
    }),
    REFRESH_HMAC_KEY: base64Key(),
    REFRESH_KEY_VERSION: "rt1",
    CSRF_KEY_VERSION: "cs1",
    CURSOR_HMAC_KEY: base64Key(),
    WEB_COOKIE_SECURE: "false",
    WEB_ORIGIN_ALLOWLIST: "https://admin.example",
    PASSWORD_BREACH_CHECK_MODE: "bypass",
    PAYMENT_RECONCILIATION_EXPIRY_GRACE_SECONDS: String(GRACE_SECONDS),
    NODE_ENV: "test",
    ...extra,
  }
}

const gatewayEnv = {
  PAYMENTS_SERVICE_URL: "http://127.0.0.1:1",
  PAYMENTS_SERVICE_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
}

const runWorkerOnce = async (extra: Readonly<Record<string, string>> = {}) => {
  const worker = composePaymentReconciliationWorker(workerEnv(extra))
  try {
    return { summary: await worker.runOnce(), gatewayConfigured: worker.gatewayConfigured }
  } finally {
    await worker.dispose()
  }
}

const expiryFor = (kind: Kind, now: number): Date => {
  if (kind === "withinGrace") return new Date(now - (GRACE_SECONDS * 1000) / 2)
  if (kind === "withinExpiry") return new Date(now + 10 * MINUTE_MS)
  return new Date(now - GRACE_SECONDS * 1000 - 30 * MINUTE_MS)
}

const seedCheckout = (kind: Kind): Promise<Seeded> =>
  unitOfWork.execute(async (tx) => {
    const now = new Date()
    const order = await orderRepository.createPurchase(tx, {
      userId, fundId, fundVersionId, amountPaise: AMOUNT_PAISE, currency: "INR", now,
    })
    await paymentsRepository.markOrderPaymentPending(tx, order.id, now)
    const payment = await paymentsRepository.createPayment(tx, {
      orderId: order.id, userId, amountPaise: AMOUNT_PAISE, currency: "INR",
    })
    const checkoutExpiresAt = expiryFor(kind, now.getTime())
    const attempt = await paymentsRepository.createAttempt(tx, {
      paymentId: payment.id,
      userId,
      attemptNumber: 1,
      merchantOrderId: newMerchantOrderId("boe-dev"),
      checkoutExpiresAt,
      checkoutChannel: "hosted_redirect",
    })
    if (kind === "staleWithLiveSibling") {
      await paymentsRepository.createAttempt(tx, {
        paymentId: payment.id,
        userId,
        attemptNumber: 2,
        merchantOrderId: newMerchantOrderId("boe-dev"),
        checkoutExpiresAt: new Date(now.getTime() + 10 * MINUTE_MS),
        checkoutChannel: "hosted_redirect",
      })
    }
    if (kind === "staleDispatchStarted" || kind === "staleDispatched" || kind === "settled") {
      await paymentsRepository.markAttemptDispatchStarted(tx, attempt.id, now)
    }
    if (kind === "staleDispatched" || kind === "settled") {
      await paymentsRepository.markAttemptDispatched(tx, {
        attemptId: attempt.id, providerOrderId: `provider-${attempt.id}`, checkoutExpiresAt, now,
      })
      await paymentsRepository.markPaymentProviderPending(tx, payment.id, now)
    }
    if (kind === "settled") {
      await paymentsRepository.markAttemptSucceeded(tx, {
        attemptId: attempt.id, providerState: "COMPLETED", providerOrderId: `provider-${attempt.id}`, now,
      })
      await paymentsRepository.markPaymentSucceeded(tx, payment.id, now)
    }
    return { orderId: order.id, paymentId: payment.id, attemptId: attempt.id }
  })

const snapshot = async (seeded: Seeded): Promise<readonly unknown[][]> => {
  const results = await Promise.all([
    pool.query<Record<string, unknown>>("select * from investment_orders where id = $1", [seeded.orderId]),
    pool.query<Record<string, unknown>>("select * from payments where id = $1", [seeded.paymentId]),
    pool.query<Record<string, unknown>>("select * from payment_attempts where id = $1", [seeded.attemptId]),
  ])
  return results.map((result): unknown[] => result.rows)
}

const staleAuditCount = async (paymentId: string): Promise<number> => {
  const result = await pool.query(
    "select 1 from audit_events where command = 'payment.expire_stale_checkout' and entity_id = $1",
    [paymentId],
  )
  return result.rowCount ?? 0
}

const seedClientAndFund = async (): Promise<void> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, '+14155550199', 'Stale Client', 'active', now()) returning id",
    [`stale-${randomUUID().slice(0, 8)}@example.com`],
  )
  userId = user.rows[0]!.id
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ('stale-fund', 'published', now(), $1) returning id",
    [userId],
  )
  fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), userId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
      "minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, " +
      "terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'Stale Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4) returning id",
    [fundId, disclosure.rows[0]!.id, randomBytes(32), userId],
  )
  fundVersionId = version.rows[0]!.id
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [fundVersionId, fundId])
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
  unitOfWork = createUnitOfWork(createDatabase(pool))
  await seedClientAndFund()
}, 220_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("stale checkout expiry while no payment gateway is configured", () => {
  test("expires only never-dispatched checkouts past their pay-by time and grace with no live sibling, once", async () => {
    const stale = await seedCheckout("staleUndispatched")
    const untouched = await Promise.all(
      (["withinGrace", "withinExpiry", "staleDispatched", "staleDispatchStarted", "staleWithLiveSibling", "settled"] as const)
        .map((kind) => seedCheckout(kind)),
    )
    const untouchedBefore = await Promise.all(untouched.map(snapshot))
    const orderBefore = await pool.query("select * from investment_orders where id = $1", [stale.orderId])

    const first = await runWorkerOnce()

    expect(first.gatewayConfigured).toBe(false)
    expect(first.summary.staleAttemptsExpired).toBe(1)
    const attempt = await pool.query("select state, provider_state from payment_attempts where id = $1", [stale.attemptId])
    expect(attempt.rows).toEqual([{ state: "expired", provider_state: null }])
    const payment = await pool.query("select state from payments where id = $1", [stale.paymentId])
    expect(payment.rows).toEqual([{ state: "expired" }])
    const orderAfter = await pool.query("select * from investment_orders where id = $1", [stale.orderId])
    expect(orderAfter.rows).toEqual(orderBefore.rows)
    expect(await staleAuditCount(stale.paymentId)).toBe(1)
    expect(await Promise.all(untouched.map(snapshot))).toEqual(untouchedBefore)

    const staleAfterFirst = await snapshot(stale)
    const second = await runWorkerOnce()

    expect(second.summary.staleAttemptsExpired).toBe(0)
    expect(await snapshot(stale)).toEqual(staleAfterFirst)
    expect(await staleAuditCount(stale.paymentId)).toBe(1)
    expect(await Promise.all(untouched.map(snapshot))).toEqual(untouchedBefore)
  })

  test("a run with a payment gateway configured leaves the stale checkout to normal reconciliation", async () => {
    const stale = await seedCheckout("staleUndispatched")

    const run = await runWorkerOnce(gatewayEnv)

    expect(run.gatewayConfigured).toBe(true)
    expect(run.summary.staleAttemptsExpired).toBeUndefined()
    const attempt = await pool.query("select state from payment_attempts where id = $1", [stale.attemptId])
    expect(attempt.rows).toEqual([{ state: "created" }])
    const payment = await pool.query("select state from payments where id = $1", [stale.paymentId])
    expect(payment.rows).toEqual([{ state: "created" }])
    expect(await staleAuditCount(stale.paymentId)).toBe(0)
  })
})
