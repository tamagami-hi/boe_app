import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService } from "../../src/auth/accessToken.js"
import { hashPassword } from "../../src/auth/passwordHasher.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import type {
  CheckoutCreated,
  OrderStatusFact,
  PaymentGateway,
  RefundInitiated,
  RefundStatusFact,
  VerifiedCallback,
} from "../../src/providers/phonepe/paymentGateway.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createInvestmentReviewRepository } from "../../src/repositories/investmentReviewRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createPaymentsRepository } from "../../src/repositories/paymentsRepository.js"
import { createProviderEventInboxRepository } from "../../src/repositories/providerEventInboxRepository.js"
import { createRefundRepository } from "../../src/repositories/refundRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminInvestmentReviewRoutes } from "../../src/routes/adminInvestmentReviewRoutes.js"
import { registerClientOrderRoutes } from "../../src/routes/clientOrderRoutes.js"
import { registerPhonePeProviderEventRoutes } from "../../src/routes/phonePeProviderEventRoutes.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"
const CALLBACK_AUTH = "Basic dGVzdDpzZWNyZXQ="

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

const cookieJar = (setCookie: string | string[] | undefined): Record<string, string> => {
  const arr = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  const jar: Record<string, string> = {}
  for (const cookie of arr) {
    const pair = cookie.split(";")[0] ?? ""
    const index = pair.indexOf("=")
    if (index !== -1) jar[pair.slice(0, index)] = pair.slice(index + 1)
  }
  return jar
}
const cookieHeader = (jar: Record<string, string>): string =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")

interface Session {
  readonly jar: Record<string, string>
  readonly csrf: string
}

let accessTokenService: ReturnType<typeof createAccessTokenService>

const seedClientToken = async (email: string): Promise<{ userId: string; token: string }> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1,$2,'Client Person','active', now()) returning id",
    [email, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
  )
  const userId = user.rows[0]!.id
  await pool.query(
    "insert into kyc_cases (user_id, state, submitted_at, decided_at) values ($1, 'approved', now(), now())",
    [userId],
  )
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [userId],
  )
  const token = await accessTokenService.sign({ sub: userId, sid: session.rows[0]!.id })
  return { userId, token }
}

const createAdmin = async (email: string, roleCode: "finance" | "support"): Promise<string> => {
  const userRow = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Admin User', 'active', now()) returning id",
    [email, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
  )
  const userId = userRow.rows[0]!.id
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [
    userId,
    await hashPassword(PASSWORD),
  ])
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
  return userId
}

const login = async (email: string): Promise<Session> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/web/login",
    headers: { origin: ORIGIN },
    payload: { email, password: PASSWORD },
  })
  expect(response.statusCode).toBe(200)
  return {
    jar: cookieJar(response.headers["set-cookie"]),
    csrf: dataOf<{ csrfToken: string }>(response).csrfToken,
  }
}

const adminHeaders = (session: Session, extra: Record<string, string> = {}): Record<string, string> => ({
  origin: ORIGIN,
  cookie: cookieHeader(session.jar),
  "x-csrf-token": session.csrf,
  ...extra,
})

const seedPublishedFund = async (
  slug: string,
  actorId: string,
): Promise<{ fundId: string; versionId: string }> => {
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1,'published', now(), $2) returning id",
    [slug, actorId],
  )
  const fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), actorId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
      "minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, " +
      "terms_sha256, created_by_user_id) " +
      "values ($1, 1, $2, 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $3, $4, $5) returning id",
    [fundId, `Fund ${slug}`, disclosure.rows[0]!.id, randomBytes(32), actorId],
  )
  const versionId = version.rows[0]!.id
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [versionId, fundId])
  return { fundId, versionId }
}

let stubOutcome: "succeeded" | "failed" | "pending" = "succeeded"
let stubRedirectUrl = "https://phonepe.test/checkout/abc"

const stubGateway: PaymentGateway = {
  createCheckout: async (command): Promise<CheckoutCreated> => ({
    redirectUrl: stubRedirectUrl,
    providerOrderId: `provider_${command.merchantOrderId}`,
    expiresAt: null,
  }),
  getOrderStatus: async (merchantOrderId): Promise<OrderStatusFact> => ({
    outcome: stubOutcome,
    providerState: stubOutcome.toUpperCase(),
    providerOrderId: `provider_${merchantOrderId}`,
    amountPaise: null,
    details: [],
  }),
  validateShaCallback: (authorizationHeader, rawBody): VerifiedCallback => {
    if (authorizationHeader !== CALLBACK_AUTH) throw new Error("bad auth")
    return JSON.parse(rawBody) as VerifiedCallback
  },
  initiateRefund: async (command): Promise<RefundInitiated> => ({
    providerRefundId: `provrf_${command.merchantRefundId}`,
    outcome: "succeeded",
    providerState: "COMPLETED",
  }),
  getRefundStatus: async (merchantRefundId): Promise<RefundStatusFact> => ({
    merchantRefundId,
    originalMerchantOrderId: null,
    amountPaise: null,
    outcome: "succeeded",
    providerState: "COMPLETED",
  }),
}

let financeAdminId: string
let financeSession: Session
let supportSession: Session

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

  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)

  const nativeKeyPair = await generateKeyPair("ES256", { extractable: true })
  accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(nativeKeyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(nativeKeyPair.publicKey) },
  })
  const webAuth: WebAuthDeps = {
    userRepository: createUserRepository(),
    authSessionRepository: createAuthSessionRepository(),
    auditRepository: createAuditRepository(),
    accessTokenService,
    database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rt1",
    csrfKeyVersion: "cs1",
    clock: () => new Date(),
    config: { cookieSecure: false, originAllowlist: [ORIGIN] },
  }

  const paymentsRepository = createPaymentsRepository()
  const refundRepository = createRefundRepository()
  const reviewRepository = createInvestmentReviewRepository()
  const providerEventInboxRepository = createProviderEventInboxRepository()

  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerWebAuthRoutes(instance, {
        ...webAuth,
        unitOfWork,
        loginEventRepository: createLoginEventRepository(),
      })
      registerClientOrderRoutes(instance, {
        accessTokenService,
        database,
        unitOfWork,
        clock: () => new Date(),
        orderRepository: createOrderRepository(),
        userRepository: createUserRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
        paymentsRepository,
        paymentGateway: stubGateway,
        config: { idempotencyTtlMs: 86_400_000, attemptTtlMs: 900_000 },
      })
      registerPhonePeProviderEventRoutes(instance, {
        unitOfWork,
        clock: () => new Date(),
        paymentGateway: stubGateway,
        config: {
          payloadEncryptionKey: randomBytes(32),
          payloadKeyVersion: "ek1",
        },
        providerEventInboxRepository,
        paymentsRepository,
        refundRepository,
      })
      registerAdminInvestmentReviewRoutes(instance, {
        webAuth,
        unitOfWork,
        database,
        clock: () => new Date(),
        config: { idempotencyTtlMs: 86_400_000 },
        reviewRepository,
        paymentsRepository,
        refundRepository,
        paymentGateway: stubGateway,
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
      })
    },
  })

  financeAdminId = await createAdmin("payrev-finance@example.com", "finance")
  await createAdmin("payrev-support@example.com", "support")
  financeSession = await login("payrev-finance@example.com")
  supportSession = await login("payrev-support@example.com")
}, 220_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const callbackFor = (merchantOrderId: string, event: string, providerState: string): string =>
  JSON.stringify({
    event,
    outcome: providerState === "COMPLETED" ? "succeeded" : providerState === "FAILED" ? "failed" : "pending",
    providerState,
    merchantOrderId,
    merchantRefundId: null,
    originalMerchantOrderId: null,
    providerOrderId: `provider_${merchantOrderId}`,
    providerRefundId: null,
    amountPaise: null,
    details: [],
  })

describe("checkout orchestrator", () => {
  test("creates an order, dispatches a checkout, and reuses the same attempt on retry", async () => {
    const { userId, token } = await seedClientToken(`client-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`pay-checkout-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)

    const created = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: { ...bearer(token), "idempotency-key": `create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "1000000" },
    })
    expect(created.statusCode).toBe(201)
    const orderId = dataOf<{ orderId: string }>(created).orderId

    const pay = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `pay-${randomUUID()}` },
    })
    expect(pay.statusCode).toBe(200)
    const payBody = dataOf<{ checkout: { url: string } }>(pay)
    expect(payBody.checkout.url).toBe(stubRedirectUrl)

    const attempts = await pool.query<{ count: string }>(
      "select count(*) as count from payment_attempts where user_id = $1",
      [userId],
    )
    expect(Number(attempts.rows[0]!.count)).toBe(1)

    const retryKey = `pay-retry-${randomUUID()}`
    const retry = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": retryKey },
    })
    expect(retry.statusCode).toBe(200)

    const attemptsAfterRetry = await pool.query<{ count: string }>(
      "select count(*) as count from payment_attempts where user_id = $1",
      [userId],
    )
    expect(Number(attemptsAfterRetry.rows[0]!.count)).toBe(1)
  })
})

describe("PhonePe callback processing", () => {
  test("a succeeded callback moves the order to review_pending and creates one pending review", async () => {
    const { token } = await seedClientToken(`client-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await seedPublishedFund(`pay-cb-${randomUUID().slice(0, 8)}`, financeAdminId)

    const created = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: { ...bearer(token), "idempotency-key": `create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "1000000" },
    })
    const orderId = dataOf<{ orderId: string }>(created).orderId
    await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `pay-${randomUUID()}` },
    })

    const attempt = await pool.query<{ merchant_order_id: string }>(
      "select merchant_order_id from payment_attempts where payment_id = " +
        "(select id from payments where order_id = $1)",
      [orderId],
    )
    const merchantOrderId = attempt.rows[0]!.merchant_order_id

    const callback = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/payment",
      headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
      payload: callbackFor(merchantOrderId, "checkout.order.completed", "COMPLETED"),
    })
    expect(callback.statusCode).toBe(200)

    const order = await pool.query<{ state: string }>(
      "select state from investment_orders where id = $1",
      [orderId],
    )
    expect(order.rows[0]!.state).toBe("review_pending")

    const reviews = await pool.query<{ state: string; bank_verified: boolean }>(
      "select state, bank_verified from investment_reviews where order_id = $1",
      [orderId],
    )
    expect(reviews.rows).toHaveLength(1)
    expect(reviews.rows[0]!.state).toBe("pending")
    expect(reviews.rows[0]!.bank_verified).toBe(false)

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/payment",
      headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
      payload: callbackFor(merchantOrderId, "checkout.order.completed", "COMPLETED"),
    })
    expect(duplicate.statusCode).toBe(200)
    const reviewsAfterDuplicate = await pool.query<{ count: string }>(
      "select count(*) as count from investment_reviews where order_id = $1",
      [orderId],
    )
    expect(Number(reviewsAfterDuplicate.rows[0]!.count)).toBe(1)
  })

  test("a bad callback authorization makes zero writes", async () => {
    const { token } = await seedClientToken(`client-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await seedPublishedFund(`pay-cb-bad-${randomUUID().slice(0, 8)}`, financeAdminId)
    const created = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: { ...bearer(token), "idempotency-key": `create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "1000000" },
    })
    const orderId = dataOf<{ orderId: string }>(created).orderId
    await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `pay-${randomUUID()}` },
    })
    const attempt = await pool.query<{ merchant_order_id: string }>(
      "select merchant_order_id from payment_attempts where payment_id = " +
        "(select id from payments where order_id = $1)",
      [orderId],
    )
    const merchantOrderId = attempt.rows[0]!.merchant_order_id
    const eventsBefore = await pool.query<{ count: string }>(
      "select count(*) as count from provider_events where merchant_order_id = $1",
      [merchantOrderId],
    )

    const response = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/payment",
      headers: { authorization: "Basic bad", "content-type": "application/json" },
      payload: callbackFor(merchantOrderId, "checkout.order.completed", "COMPLETED"),
    })
    expect(response.statusCode).toBe(401)

    const order = await pool.query<{ state: string }>(
      "select state from investment_orders where id = $1",
      [orderId],
    )
    expect(order.rows[0]!.state).toBe("payment_pending")
    const eventsAfter = await pool.query<{ count: string }>(
      "select count(*) as count from provider_events where merchant_order_id = $1",
      [merchantOrderId],
    )
    expect(eventsAfter.rows[0]!.count).toBe(eventsBefore.rows[0]!.count)
  })
})

const advanceOrderToReview = async (
  fundSlugPrefix: string,
): Promise<{ orderId: string; userId: string; fundId: string }> => {
  const { userId, token } = await seedClientToken(`client-${randomUUID().slice(0, 8)}@example.com`)
  const fund = await seedPublishedFund(`${fundSlugPrefix}-${randomUUID().slice(0, 8)}`, financeAdminId)
  const created = await app.inject({
    method: "POST",
    url: "/v1/client/orders",
    headers: { ...bearer(token), "idempotency-key": `create-${randomUUID()}` },
    payload: { fundId: fund.fundId, amountPaise: "1000000" },
  })
  const orderId = dataOf<{ orderId: string }>(created).orderId
  await app.inject({
    method: "POST",
    url: `/v1/client/orders/${orderId}/pay`,
    headers: { ...bearer(token), "idempotency-key": `pay-${randomUUID()}` },
  })
  const attempt = await pool.query<{ merchant_order_id: string }>(
    "select merchant_order_id from payment_attempts where payment_id = " +
      "(select id from payments where order_id = $1)",
    [orderId],
  )
  await app.inject({
    method: "POST",
    url: "/v1/provider-events/phonepe/payment",
    headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
    payload: callbackFor(attempt.rows[0]!.merchant_order_id, "checkout.order.completed", "COMPLETED"),
  })
  return { orderId, userId, fundId: fund.fundId }
}

describe("admin accept", () => {
  test("accepts a reviewed order into exactly one allocation and one contribution", async () => {
    const { orderId, userId, fundId } = await advanceOrderToReview("pay-acc")

    const review = await pool.query<{ id: string; version: string }>(
      "select id, version from investment_reviews where order_id = $1",
      [orderId],
    )

    const accept = await app.inject({
      method: "POST",
      url: `/v1/admin/investment-reviews/${orderId}/accept`,
      headers: adminHeaders(financeSession, { "idempotency-key": `accept-${randomUUID()}` }),
      payload: { bankVerified: true, expectedVersion: Number(review.rows[0]!.version) },
    })
    expect(accept.statusCode).toBe(200)
    expect(dataOf<{ state: string }>(accept).state).toBe("accepted")

    const order = await pool.query<{ state: string }>(
      "select state from investment_orders where id = $1",
      [orderId],
    )
    expect(order.rows[0]!.state).toBe("accepted")

    const allocations = await pool.query<{ count: string }>(
      "select count(*) as count from investment_allocations where order_id = $1",
      [orderId],
    )
    expect(Number(allocations.rows[0]!.count)).toBe(1)

    const contributions = await pool.query<{ count: string }>(
      "select count(*) as count from client_value_entries where order_id = $1 and entry_type = 'contribution'",
      [orderId],
    )
    expect(Number(contributions.rows[0]!.count)).toBe(1)

    const aumRows = await pool.query<{ count: string }>(
      "select count(*) as count from fund_aum_snapshots where fund_id = $1",
      [fundId],
    )
    expect(Number(aumRows.rows[0]!.count)).toBe(0)
    void userId
  })

  test("a stale version conflicts and writes nothing", async () => {
    const { orderId } = await advanceOrderToReview("pay-stale")
    const allocationsBefore = await pool.query<{ count: string }>(
      "select count(*) as count from investment_allocations where order_id = $1",
      [orderId],
    )

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/investment-reviews/${orderId}/accept`,
      headers: adminHeaders(financeSession, { "idempotency-key": `accept-stale-${randomUUID()}` }),
      payload: { bankVerified: true, expectedVersion: 999 },
    })
    expect(response.statusCode).toBe(409)

    const allocationsAfter = await pool.query<{ count: string }>(
      "select count(*) as count from investment_allocations where order_id = $1",
      [orderId],
    )
    expect(allocationsAfter.rows[0]!.count).toBe(allocationsBefore.rows[0]!.count)
  })

  test("a replayed accept returns the same result without a second allocation", async () => {
    const { orderId } = await advanceOrderToReview("pay-replay")
    const review = await pool.query<{ version: string }>(
      "select version from investment_reviews where order_id = $1",
      [orderId],
    )
    const key = `accept-replay-${randomUUID()}`
    const payload = { bankVerified: true, expectedVersion: Number(review.rows[0]!.version) }

    const first = await app.inject({
      method: "POST",
      url: `/v1/admin/investment-reviews/${orderId}/accept`,
      headers: adminHeaders(financeSession, { "idempotency-key": key }),
      payload,
    })
    expect(first.statusCode).toBe(200)

    const replay = await app.inject({
      method: "POST",
      url: `/v1/admin/investment-reviews/${orderId}/accept`,
      headers: adminHeaders(financeSession, { "idempotency-key": key }),
      payload,
    })
    expect(replay.statusCode).toBe(200)

    const allocations = await pool.query<{ count: string }>(
      "select count(*) as count from investment_allocations where order_id = $1",
      [orderId],
    )
    expect(Number(allocations.rows[0]!.count)).toBe(1)
  })

  test("requires investments.review.write", async () => {
    const { orderId } = await advanceOrderToReview("pay-rbac")
    const review = await pool.query<{ version: string }>(
      "select version from investment_reviews where order_id = $1",
      [orderId],
    )

    const denied = await app.inject({
      method: "POST",
      url: `/v1/admin/investment-reviews/${orderId}/accept`,
      headers: adminHeaders(supportSession, { "idempotency-key": `accept-denied-${randomUUID()}` }),
      payload: { bankVerified: true, expectedVersion: Number(review.rows[0]!.version) },
    })
    expect(denied.statusCode).toBe(403)
    expect(errorOf(denied)).toBe("AUTHORIZATION_DENIED")
  })
})

describe("admin reject and refund", () => {
  test("rejecting a reviewed order creates no contribution and starts a refund", async () => {
    const { orderId } = await advanceOrderToReview("pay-rej")
    const review = await pool.query<{ version: string }>(
      "select version from investment_reviews where order_id = $1",
      [orderId],
    )

    const reject = await app.inject({
      method: "POST",
      url: `/v1/admin/investment-reviews/${orderId}/reject`,
      headers: adminHeaders(financeSession, { "idempotency-key": `reject-${randomUUID()}` }),
      payload: { reasonCode: "bank_mismatch", expectedVersion: Number(review.rows[0]!.version) },
    })
    expect(reject.statusCode).toBe(200)
    const refundId = dataOf<{ refundId: string }>(reject).refundId

    const order = await pool.query<{ state: string }>(
      "select state from investment_orders where id = $1",
      [orderId],
    )
    expect(order.rows[0]!.state).toBe("refund_pending")

    const contributions = await pool.query<{ count: string }>(
      "select count(*) as count from client_value_entries where order_id = $1 and entry_type = 'contribution'",
      [orderId],
    )
    expect(Number(contributions.rows[0]!.count)).toBe(0)

    const refund = await pool.query<{ state: string; merchant_refund_id: string }>(
      "select state, merchant_refund_id from refund_operations where id = $1",
      [refundId],
    )
    expect(refund.rows[0]!.state).toBe("pending")
    expect(refund.rows[0]!.merchant_refund_id).toMatch(/^boerf_/u)
  })

  test("reconcile applies the gateway's refunded outcome", async () => {
    const { orderId } = await advanceOrderToReview("pay-reconcile")
    const review = await pool.query<{ version: string }>(
      "select version from investment_reviews where order_id = $1",
      [orderId],
    )
    const reject = await app.inject({
      method: "POST",
      url: `/v1/admin/investment-reviews/${orderId}/reject`,
      headers: adminHeaders(financeSession, { "idempotency-key": `reject-rec-${randomUUID()}` }),
      payload: { reasonCode: "bank_mismatch", expectedVersion: Number(review.rows[0]!.version) },
    })
    const refundId = dataOf<{ refundId: string }>(reject).refundId

    const reconcile = await app.inject({
      method: "POST",
      url: `/v1/admin/refunds/${refundId}/reconcile`,
      headers: adminHeaders(financeSession, { "idempotency-key": `reconcile-${randomUUID()}` }),
    })
    expect(reconcile.statusCode).toBe(200)
    expect(dataOf<{ state: string }>(reconcile).state).toBe("refunded")

    const order = await pool.query<{ state: string }>(
      "select state from investment_orders where id = $1",
      [orderId],
    )
    expect(order.rows[0]!.state).toBe("refunded")
  })
})
