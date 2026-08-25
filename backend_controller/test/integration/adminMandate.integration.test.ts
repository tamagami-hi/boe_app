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
import { createDatabase, createUnitOfWork, type UnitOfWork } from "../../src/db/database.js"
import type { Transaction } from "../../src/db/repositories.js"
import { createPool } from "../../src/db/pool.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import type { MandateStatus, CollectionStatus } from "../../src/providers/recurringPaymentGateway.js"
import { createAdminMandateRepository } from "../../src/repositories/adminMandateRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createMandatesRepository } from "../../src/repositories/mandatesRepository.js"
import { createPaymentsRepository } from "../../src/repositories/paymentsRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminMandateRoutes, type AdminMandateDeps } from "../../src/routes/adminMandateRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

type Mutable<T> = { -readonly [P in keyof T]: T[P] }

let container: StartedPostgreSqlContainer
let pool: Pool
let database: ReturnType<typeof createDatabase>
let app: FastifyInstance
let routeDeps: AdminMandateDeps

let adminToken: string
let adminId: string
let supportToken: string

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const metaOf = (response: { json: () => unknown }): { idempotencyReplay?: boolean } =>
  (response.json() as { meta: { idempotencyReplay?: boolean } }).meta
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

interface Injected {
  statusCode: number
  json: () => unknown
}

const asInjected = (response: unknown): Injected => response as Injected

const makeUser = async (
  access: AccessTokenService,
  email: string,
): Promise<{ userId: string; token: string }> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1,$2,'Test Person','active', now()) returning id",
    [email, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
  )
  const userId = user.rows[0]!.id
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [userId],
  )
  const token = await access.sign({ sub: userId, sid: session.rows[0]!.id })
  return { userId, token }
}

const grantRole = async (userId: string, roleCode: string): Promise<void> => {
  for (const permission of SEED_ROLE_PERMISSIONS[roleCode] ?? []) {
    await pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) " +
        "select r.id, p.id, $1 from roles r, permissions p where r.code = $2 and p.code = $3 " +
        "on conflict do nothing",
      [userId, roleCode, permission],
    )
  }
  await pool.query(
    "insert into user_roles (user_id, role_id, granted_by_user_id) select $1, id, $1 from roles where code = $2",
    [userId, roleCode],
  )
}

const seedFund = async (slug: string): Promise<{ fundId: string; versionId: string }> => {
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, created_by_user_id) values ($1,'draft',$2) returning id",
    [slug, adminId],
  )
  const fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Terms', 'Terms body', $2, now(), $3) returning id",
    [fundId, randomBytes(32), adminId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'Test Fund', 'hybrid', 'Growth', 'moderate', 'moderate', 100, 100, $2, $3, $4) returning id",
    [fundId, disclosure.rows[0]!.id, randomBytes(32), adminId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, fundId])
  return { fundId, versionId: version.rows[0]!.id }
}

const createSipAndMandate = async (
  fundId: string,
  state: "pending_mandate" | "active" | "paused" = "pending_mandate",
): Promise<{ userId: string; sipPlanId: string; mandateId: string; merchantSubscriptionId: string }> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Mandate Owner', 'active', now()) returning id",
    [`${randomUUID()}@example.com`, `+91${String(Math.floor(1000000000 + Math.random() * 8999999999))}`],
  )
  const userId = user.rows[0]!.id
  const merchantSubscriptionId = `MS_${randomUUID()}`
  const unitOfWork = createUnitOfWork(database)
  const result = await unitOfWork.execute(async (tx) => {
    const sip = await tx
      .insertInto("sip_plans")
      .values({
        user_id: userId,
        fund_id: fundId,
        amount_paise: "50000",
        debit_day: 5,
        duration_months: 12,
        state,
        collection_mode: "phonepe_autopay",
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    const mandate = await createMandatesRepository().createMandate(tx, {
      sipPlanId: sip.id,
      userId,
      fundId,
      merchantSubscriptionId,
      maxAmountPaise: "50000",
    })
    return { sipPlanId: sip.id, mandateId: mandate.id }
  })
  return { userId, ...result, merchantSubscriptionId }
}

const activateMandate = async (
  mandateId: string,
  sipPlanId: string,
): Promise<{ providerSubscriptionId: string }> => {
  const unitOfWork = createUnitOfWork(database)
  const repository = createMandatesRepository()
  const providerSubscriptionId = `PS_${randomUUID()}`
  const result = await unitOfWork.execute(async (tx) => {
    const mandate = await repository.findMandateForAdmin(tx, mandateId)
    const sip = await tx.selectFrom("sip_plans").selectAll().where("id", "=", sipPlanId).executeTakeFirstOrThrow()
    if (mandate === null) throw new Error("mandate not found")
    return repository.applyProviderMandateState(tx, {
      merchantSubscriptionId: mandate.merchant_subscription_id,
      providerSubscriptionId,
      expectedVersion: mandate.version,
      expectedSipVersion: sip.version,
      fromState: "setup_pending",
      toState: "active",
      now: new Date(),
    })
  })
  if (result === null) throw new Error("failed to activate mandate")
  return { providerSubscriptionId }
}

const createCollectionAttempt = async (
  mandateId: string,
  sipPlanId: string,
  userId: string,
  fundId: string,
  versionId: string,
): Promise<{ collectionId: string; paymentAttemptId: string; merchantOrderId: string }> => {
  const order = await pool.query<{ id: string }>(
    "insert into investment_orders (user_id, fund_id, fund_version_id, sip_plan_id, type, state, amount_paise, due_period) " +
      "values ($1, $2, $3, $4, 'sip_installment', 'payment_pending', 50000, '2026-09-01') returning id",
    [userId, fundId, versionId, sipPlanId],
  )
  const payment = await pool.query<{ id: string }>(
    "insert into payments (order_id, user_id, amount_paise) values ($1, $2, 50000) returning id",
    [order.rows[0]!.id, userId],
  )
  const merchantOrderId = `MO_${randomUUID()}`
  const attempt = await pool.query<{ id: string }>(
    "insert into payment_attempts (payment_id, user_id, attempt_number, provider, checkout_channel, merchant_order_id) " +
      "values ($1, $2, 1, 'phonepe', 'phonepe_autopay', $3) returning id",
    [payment.rows[0]!.id, userId, merchantOrderId],
  )
  const collection = await pool.query<{ id: string }>(
    "insert into mandate_collection_attempts (mandate_id, sip_plan_id, user_id, fund_id, amount_paise, due_period, scheduled_debit_at, notify_at, order_id, payment_id, payment_attempt_id, retry_strategy) " +
      "values ($1, $2, $3, $4, 50000, '2026-09-01', now() + interval '1 day', now(), $5, $6, $7, 'standard') returning id",
    [mandateId, sipPlanId, userId, fundId, order.rows[0]!.id, payment.rows[0]!.id, attempt.rows[0]!.id],
  )
  const collectionId = collection.rows[0]!.id
  await pool.query(
    "update mandate_collection_attempts set notify_state = 'dispatching', notify_dispatch_started_at = now(), updated_at = now() where id = $1",
    [collectionId],
  )
  await pool.query(
    "update payment_attempts set provider_dispatch_started_at = now(), provider_order_id = $1, updated_at = now() where id = $2",
    [`PO_${randomUUID()}`, attempt.rows[0]!.id],
  )
  return { collectionId, paymentAttemptId: attempt.rows[0]!.id, merchantOrderId }
}

const gatewayCalls: { operation: string; merchantId: string }[] = []
let nextMandateStatus: MandateStatus | null = null
let nextCollectionStatus: CollectionStatus | null = null

let transactionDepth = 0

const fakeRecurringGateway = {
  createMandateSdkOrder: async () => ({ providerOrderId: "po", providerState: "PENDING" as const, sdkToken: "token", expiresAt: new Date() }),
  getSetupOrderStatus: async () => ({ state: "PENDING" as const, providerOrderId: null, merchantSubscriptionId: "", providerSubscriptionId: null, paymentDetails: [] }),
  getMandateStatus: async (merchantSubscriptionId: string): Promise<MandateStatus> => {
    gatewayCalls.push({ operation: "getMandateStatus", merchantId: merchantSubscriptionId })
    if (nextMandateStatus !== null) return nextMandateStatus
    return { state: "ACTIVE", merchantSubscriptionId, providerSubscriptionId: `PS_${randomUUID()}` }
  },
  getCollectionStatus: async (merchantOrderId: string): Promise<CollectionStatus> => {
    gatewayCalls.push({ operation: "getCollectionStatus", merchantId: merchantOrderId })
    if (nextCollectionStatus !== null) return nextCollectionStatus
    return { state: "NOTIFIED", merchantOrderId, providerOrderId: null, merchantSubscriptionId: "", amountPaise: "50000", expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), paymentDetails: [] }
  },
  notifyCollection: async () => ({ providerOrderId: "po", providerState: "NOTIFICATION_IN_PROGRESS" as const, expiresAt: new Date() }),
  cancelMandate: async () => undefined,
}

const trackTransactionDepth = (unitOfWork: UnitOfWork): UnitOfWork =>
  ({
    execute: async <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => {
      transactionDepth += 1
      try {
        return await unitOfWork.execute(fn)
      } finally {
        transactionDepth -= 1
      }
    },
  } as unknown as UnitOfWork)

const postJson = (
  url: string,
  token: string,
  payload: Record<string, unknown>,
  key?: string,
): Promise<unknown> =>
  app.inject({
    method: "POST",
    url,
    headers: { ...bearer(token), "content-type": "application/json", ...(key === undefined ? {} : { "idempotency-key": key }) },
    payload,
  }) as Promise<unknown>

const getJson = (url: string, token: string): Promise<unknown> =>
  app.inject({
    method: "GET",
    url,
    headers: bearer(token),
  }) as Promise<unknown>

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
  await runMigrations(pool, await loadMigrationFiles(directory))
  await runSeed(pool)

  database = createDatabase(pool)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  const accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })

  const auditRepository = createAuditRepository()
  const idempotencyRepository = createIdempotencyRepository()
  const unitOfWork = createUnitOfWork(database)
  const clock = (): Date => new Date()
  const webAuth: WebAuthDeps = {
    userRepository: createUserRepository(),
    authSessionRepository: createAuthSessionRepository(),
    auditRepository,
    accessTokenService,
    database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rk1",
    csrfKeyVersion: "ck1",
    clock,
    config: { cookieSecure: false, originAllowlist: [] },
  }

  const deps: AdminMandateDeps = {
    webAuth,
    unitOfWork,
    database,
    clock,
    config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000 },
    adminMandateRepository: createAdminMandateRepository(),
    mandatesRepository: createMandatesRepository(),
    paymentsRepository: createPaymentsRepository(),
    recurringPaymentGateway: fakeRecurringGateway,
    auditRepository,
    idempotencyRepository,
  }

  routeDeps = deps

  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminMandateRoutes(instance, deps)
    },
  })

  const admin = await makeUser(accessTokenService, "mandate-admin@example.com")
  adminId = admin.userId
  adminToken = admin.token
  await grantRole(adminId, "finance")

  const support = await makeUser(accessTokenService, "mandate-support@example.com")
  supportToken = support.token
  await grantRole(support.userId, "support")
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("admin mandate list and detail", () => {
  test("lists mandates with pagination", async () => {
    const { fundId } = await seedFund("mandate-list")
    const first = await createSipAndMandate(fundId)
    const second = await createSipAndMandate(fundId)

    const response = asInjected(await getJson("/v1/admin/mandates?limit=1", adminToken))
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ items: Record<string, unknown>[]; page: { nextCursor: string | null; hasMore: boolean; limit: number } }>(response)
    expect(body.items).toHaveLength(1)
    expect(body.page.hasMore).toBe(true)
    expect(body.page.limit).toBe(1)

    const page2 = asInjected(await getJson(`/v1/admin/mandates?limit=1&after=${encodeURIComponent(body.page.nextCursor as string)}`, adminToken))
    expect(page2.statusCode).toBe(200)
    const body2 = dataOf<{ items: Record<string, unknown>[]; page: { hasMore: boolean } }>(page2)
    expect(body2.items).toHaveLength(1)

    const ids = new Set([body.items[0]?.mandateId, body2.items[0]?.mandateId])
    expect(ids).toContain(first.mandateId)
    expect(ids).toContain(second.mandateId)
  })

  test("filters by state and attention", async () => {
    const { fundId } = await seedFund("mandate-filter")
    const pending = await createSipAndMandate(fundId)

    const byState = asInjected(await getJson("/v1/admin/mandates?state=setup_pending", adminToken))
    expect(byState.statusCode).toBe(200)
    expect(dataOf<{ items: Record<string, unknown>[] }>(byState).items.some((row) => row.mandateId === pending.mandateId)).toBe(true)

    const attention = asInjected(await getJson("/v1/admin/mandates?attention=true", adminToken))
    expect(attention.statusCode).toBe(200)
    expect(dataOf<{ items: Record<string, unknown>[] }>(attention).items.some((row) => row.mandateId === pending.mandateId)).toBe(true)
  })

  test("returns mandate detail with attempts and commands", async () => {
    const { fundId, versionId } = await seedFund("mandate-detail")
    const { mandateId, userId, sipPlanId } = await createSipAndMandate(fundId)
    await activateMandate(mandateId, sipPlanId)
    await createCollectionAttempt(mandateId, sipPlanId, userId, fundId, versionId)

    const response = asInjected(await getJson(`/v1/admin/mandates/${mandateId}`, adminToken))
    expect(response.statusCode).toBe(200)
    const detail = dataOf<{
      mandate: Record<string, unknown>
      user: Record<string, unknown>
      fund: Record<string, unknown>
      sip: Record<string, unknown>
      setupAttempts: unknown[]
      collectionAttempts: unknown[]
      cancelCommands: unknown[]
    }>(response)
    expect(detail.mandate.mandateId).toBe(mandateId)
    expect(detail.sip.id).toBe(sipPlanId)
    expect(detail.collectionAttempts).toHaveLength(1)
  })

  test("requires payments.read", async () => {
    const { fundId } = await seedFund("mandate-read-perm")
    const { mandateId } = await createSipAndMandate(fundId)
    const response = asInjected(await getJson(`/v1/admin/mandates/${mandateId}`, supportToken))
    expect(response.statusCode).toBe(403)
    expect(errorOf(response)).toBe("AUTHORIZATION_DENIED")
  })
})

describe("admin mandate reconcile", () => {
  test("triggers provider inquiry and updates mandate state", async () => {
    const { fundId } = await seedFund("mandate-reconcile")
    const { mandateId, sipPlanId, merchantSubscriptionId } = await createSipAndMandate(fundId)
    const { providerSubscriptionId } = await activateMandate(mandateId, sipPlanId)

    nextMandateStatus = { state: "CANCELLED", merchantSubscriptionId, providerSubscriptionId }
    gatewayCalls.length = 0

    const response = asInjected(await postJson(`/v1/admin/mandates/${mandateId}/reconcile`, adminToken, { reason: "Investigating stale mandate" }, `reconcile-${randomUUID()}`))
    expect(response.statusCode).toBe(200)
    expect(gatewayCalls.some((call) => call.operation === "getMandateStatus" && call.merchantId === merchantSubscriptionId)).toBe(true)

    const detail = dataOf<{ mandate: { state: string } }>(response)
    expect(detail.mandate.state).toBe("cancelled")

    const audit = await pool.query<{ command: string; entity_id: string }>(
      "select command, entity_id from audit_events where command = 'mandate.reconcile' and entity_id = $1",
      [mandateId],
    )
    expect(audit.rows.length).toBeGreaterThanOrEqual(1)
  })

  test("replays idempotent reconcile without duplicate gateway call", async () => {
    const { fundId } = await seedFund("mandate-reconcile-idem")
    const { mandateId, sipPlanId, merchantSubscriptionId } = await createSipAndMandate(fundId)
    const { providerSubscriptionId } = await activateMandate(mandateId, sipPlanId)

    nextMandateStatus = { state: "ACTIVE", merchantSubscriptionId, providerSubscriptionId }
    gatewayCalls.length = 0
    const key = `idem-reconcile-${randomUUID()}`

    const first = asInjected(await postJson(`/v1/admin/mandates/${mandateId}/reconcile`, adminToken, { reason: "Check status" }, key))
    expect(first.statusCode).toBe(200)
    const callsBefore = gatewayCalls.length

    const second = asInjected(await postJson(`/v1/admin/mandates/${mandateId}/reconcile`, adminToken, { reason: "Check status" }, key))
    expect(second.statusCode).toBe(200)
    expect(metaOf(second).idempotencyReplay).toBe(true)
    expect(gatewayCalls.length).toBe(callsBefore)
  })

  test("requires finance.operate", async () => {
    const { fundId } = await seedFund("mandate-reconcile-perm")
    const { mandateId } = await createSipAndMandate(fundId)
    const response = asInjected(await postJson(`/v1/admin/mandates/${mandateId}/reconcile`, supportToken, { reason: "Check" }, `perm-${randomUUID()}`))
    expect(response.statusCode).toBe(403)
    expect(errorOf(response)).toBe("AUTHORIZATION_DENIED")
  })

  test("provider inquiry happens outside the unit-of-work transaction", async () => {
    const { fundId } = await seedFund("mandate-reconcile-tx")
    const { mandateId, sipPlanId, merchantSubscriptionId } = await createSipAndMandate(fundId)
    const { providerSubscriptionId } = await activateMandate(mandateId, sipPlanId)

    nextMandateStatus = { state: "ACTIVE", merchantSubscriptionId, providerSubscriptionId }
    transactionDepth = 0
    const mutableDeps = routeDeps as Mutable<AdminMandateDeps>
    const originalUnitOfWork = routeDeps.unitOfWork
    const originalGateway = routeDeps.recurringPaymentGateway
    mutableDeps.unitOfWork = trackTransactionDepth(originalUnitOfWork)
    mutableDeps.recurringPaymentGateway = {
      ...fakeRecurringGateway,
      getMandateStatus: async (id: string): Promise<MandateStatus> => {
        if (transactionDepth > 0) throw new Error("provider inquiry inside transaction")
        return fakeRecurringGateway.getMandateStatus(id)
      },
    }
    try {
      const response = asInjected(
        await postJson(`/v1/admin/mandates/${mandateId}/reconcile`, adminToken, { reason: "Check outside tx" }, `reconcile-tx-${randomUUID()}`),
      )
      expect(response.statusCode).toBe(200)
    } finally {
      mutableDeps.unitOfWork = originalUnitOfWork
      mutableDeps.recurringPaymentGateway = originalGateway
    }
  })
})

describe("admin mandate cancel", () => {
  test("enqueues cancel command for an active mandate", async () => {
    const { fundId } = await seedFund("mandate-cancel-active")
    const { mandateId, sipPlanId, merchantSubscriptionId } = await createSipAndMandate(fundId)
    await activateMandate(mandateId, sipPlanId)

    const response = asInjected(await postJson(`/v1/admin/mandates/${mandateId}/cancel`, adminToken, { reason: "User requested cancellation" }, `cancel-${randomUUID()}`))
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ commandId: string; state: string }>(response)
    expect(body.state).toBe("queued")

    const mandate = await pool.query<{ state: string }>("select state from payment_mandates where id = $1", [mandateId])
    expect(mandate.rows[0]?.state).toBe("cancel_pending")

    const command = await pool.query<{ previous_mandate_state: string; merchant_subscription_id: string }>(
      "select previous_mandate_state, merchant_subscription_id from mandate_cancel_commands where id = $1",
      [body.commandId],
    )
    expect(command.rows[0]?.previous_mandate_state).toBe("active")
    expect(command.rows[0]?.merchant_subscription_id).toBe(merchantSubscriptionId)
  })

  test("requests abandonment and enqueues cancel for setup_pending mandate", async () => {
    const { fundId } = await seedFund("mandate-cancel-setup")
    const { mandateId } = await createSipAndMandate(fundId)

    const response = asInjected(await postJson(`/v1/admin/mandates/${mandateId}/cancel`, adminToken, { reason: "Abandon setup" }, `cancel-setup-${randomUUID()}`))
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ commandId: string; state: string }>(response)
    expect(body.state).toBe("queued")

    const mandate = await pool.query<{ state: string; abandonment_requested_at: Date | null }>(
      "select state, abandonment_requested_at from payment_mandates where id = $1",
      [mandateId],
    )
    expect(mandate.rows[0]?.state).toBe("setup_pending")
    expect(mandate.rows[0]?.abandonment_requested_at).not.toBeNull()
  })

  test("rejects duplicate cancel attempts", async () => {
    const { fundId } = await seedFund("mandate-cancel-dup")
    const { mandateId, sipPlanId } = await createSipAndMandate(fundId)
    await activateMandate(mandateId, sipPlanId)

    const first = asInjected(await postJson(`/v1/admin/mandates/${mandateId}/cancel`, adminToken, { reason: "Cancel" }, `cancel-dup-${randomUUID()}`))
    expect(first.statusCode).toBe(200)

    const second = asInjected(await postJson(`/v1/admin/mandates/${mandateId}/cancel`, adminToken, { reason: "Cancel again" }, `cancel-dup2-${randomUUID()}`))
    expect(second.statusCode).toBe(409)
    expect(errorOf(second)).toBe("STATE_CONFLICT")
  })

  test("requires finance.operate", async () => {
    const { fundId } = await seedFund("mandate-cancel-perm")
    const { mandateId } = await createSipAndMandate(fundId)
    const response = asInjected(await postJson(`/v1/admin/mandates/${mandateId}/cancel`, supportToken, { reason: "Cancel" }, `cancel-perm-${randomUUID()}`))
    expect(response.statusCode).toBe(403)
    expect(errorOf(response)).toBe("AUTHORIZATION_DENIED")
  })
})

describe("admin mandate collection reconcile", () => {
  test("triggers provider inquiry for collection attempt", async () => {
    const { fundId, versionId } = await seedFund("mandate-collection-reconcile")
    const { mandateId, sipPlanId, userId, merchantSubscriptionId } = await createSipAndMandate(fundId)
    await activateMandate(mandateId, sipPlanId)
    const { collectionId, merchantOrderId } = await createCollectionAttempt(mandateId, sipPlanId, userId, fundId, versionId)

    nextCollectionStatus = {
      state: "COMPLETED",
      merchantOrderId,
      providerOrderId: "provider-order",
      merchantSubscriptionId,
      amountPaise: "50000",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      paymentDetails: [{ transactionId: "txn-1", state: "COMPLETED", amountPaise: "50000", instrumentType: "UPI_AUTO_PAY" }],
    }
    gatewayCalls.length = 0

    const response = asInjected(await postJson(`/v1/admin/mandate-collections/${collectionId}/reconcile`, adminToken, { reason: "Check collection" }, `coll-${randomUUID()}`))
    expect(response.statusCode).toBe(200)
    expect(gatewayCalls.some((call) => call.operation === "getCollectionStatus" && call.merchantId === merchantOrderId)).toBe(true)

    const payment = await pool.query<{ state: string }>(
      "select payment.state from payments payment join mandate_collection_attempts collection on collection.payment_id = payment.id where collection.id = $1",
      [collectionId],
    )
    expect(payment.rows[0]?.state).toBe("succeeded")
  })

  test("requires finance.operate", async () => {
    const { fundId, versionId } = await seedFund("mandate-collection-perm")
    const { mandateId, sipPlanId, userId } = await createSipAndMandate(fundId)
    await activateMandate(mandateId, sipPlanId)
    const { collectionId } = await createCollectionAttempt(mandateId, sipPlanId, userId, fundId, versionId)
    const response = asInjected(await postJson(`/v1/admin/mandate-collections/${collectionId}/reconcile`, supportToken, { reason: "Check" }, `coll-perm-${randomUUID()}`))
    expect(response.statusCode).toBe(403)
    expect(errorOf(response)).toBe("AUTHORIZATION_DENIED")
  })

  test("provider inquiry happens outside the unit-of-work transaction", async () => {
    const { fundId, versionId } = await seedFund("mandate-collection-tx")
    const { mandateId, sipPlanId, userId, merchantSubscriptionId } = await createSipAndMandate(fundId)
    await activateMandate(mandateId, sipPlanId)
    const { collectionId, merchantOrderId } = await createCollectionAttempt(mandateId, sipPlanId, userId, fundId, versionId)

    nextCollectionStatus = {
      state: "NOTIFIED",
      merchantOrderId,
      providerOrderId: null,
      merchantSubscriptionId,
      amountPaise: "50000",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      paymentDetails: [],
    }
    transactionDepth = 0
    const mutableDeps = routeDeps as Mutable<AdminMandateDeps>
    const originalUnitOfWork = routeDeps.unitOfWork
    const originalGateway = routeDeps.recurringPaymentGateway
    mutableDeps.unitOfWork = trackTransactionDepth(originalUnitOfWork)
    mutableDeps.recurringPaymentGateway = {
      ...fakeRecurringGateway,
      getCollectionStatus: async (id: string): Promise<CollectionStatus> => {
        if (transactionDepth > 0) throw new Error("provider inquiry inside transaction")
        return fakeRecurringGateway.getCollectionStatus(id)
      },
    }
    try {
      const response = asInjected(
        await postJson(`/v1/admin/mandate-collections/${collectionId}/reconcile`, adminToken, { reason: "Check outside tx" }, `coll-tx-${randomUUID()}`),
      )
      expect(response.statusCode).toBe(200)
    } finally {
      mutableDeps.unitOfWork = originalUnitOfWork
      mutableDeps.recurringPaymentGateway = originalGateway
    }
  })

  test("does not report payment success for notification acknowledgement alone", async () => {
    const { fundId, versionId } = await seedFund("mandate-collection-notify")
    const { mandateId, sipPlanId, userId, merchantSubscriptionId } = await createSipAndMandate(fundId)
    await activateMandate(mandateId, sipPlanId)
    const { collectionId, merchantOrderId } = await createCollectionAttempt(mandateId, sipPlanId, userId, fundId, versionId)

    nextCollectionStatus = {
      state: "NOTIFIED",
      merchantOrderId,
      providerOrderId: null,
      merchantSubscriptionId,
      amountPaise: "50000",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      paymentDetails: [],
    }

    const response = asInjected(
      await postJson(`/v1/admin/mandate-collections/${collectionId}/reconcile`, adminToken, { reason: "Notification only" }, `coll-notify-${randomUUID()}`),
    )
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ collectionId: string; state: string; paymentState: string | null; providerState: string }>(response)
    expect(body.state).toBe("notified")
    expect(body.providerState).toBe("NOTIFIED")
    expect(body.paymentState).not.toBe("succeeded")

    const payment = await pool.query<{ state: string }>(
      "select payment.state from payments payment join mandate_collection_attempts collection on collection.payment_id = payment.id where collection.id = $1",
      [collectionId],
    )
    expect(payment.rows[0]?.state).not.toBe("succeeded")
  })
})
