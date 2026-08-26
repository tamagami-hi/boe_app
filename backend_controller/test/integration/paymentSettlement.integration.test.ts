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
import { decryptGcm } from "../../src/crypto/primitives.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import type {
  OrderStatusFact,
  PaymentGateway,
  RefundInitiated,
  RefundStatusFact,
  VerifiedCallback,
} from "../../src/providers/phonepe/paymentGateway.js"
import { GatewayNotFoundError, GatewayRejectedError, GatewayUnavailableError } from "../../src/providers/phonepe/paymentGateway.js"
import type { MobilePaymentGateway } from "../../src/providers/mobilePaymentGateway.js"
import type { RecurringPaymentGateway } from "../../src/providers/recurringPaymentGateway.js"
import { paymentSdkTokenAad } from "../../src/providers/mobilePaymentGateway.js"
import { runReconciliationPass } from "../../src/paymentReconciliationWorker.js"
import { runMandateReconciliationPass } from "../../src/mandateReconciliationWorker.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createClientPortfolioRepository } from "../../src/repositories/clientPortfolioRepository.js"
import { createClientValueEntryRepository } from "../../src/repositories/clientValueEntryRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createFundReceiptAcknowledgementRepository } from "../../src/repositories/fundReceiptAcknowledgementRepository.js"
import { createInvestmentSettlementRepository } from "../../src/repositories/investmentSettlementRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createMandatesRepository } from "../../src/repositories/mandatesRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createPaymentsRepository } from "../../src/repositories/paymentsRepository.js"
import { createProviderEventInboxRepository } from "../../src/repositories/providerEventInboxRepository.js"
import { createSipPlanRepository } from "../../src/repositories/sipPlanRepository.js"
import { createRefundRepository } from "../../src/repositories/refundRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminFundReceiptRoutes } from "../../src/routes/adminFundReceiptRoutes.js"
import { registerClientOrderRoutes } from "../../src/routes/clientOrderRoutes.js"
import { registerClientPortfolioRoutes } from "../../src/routes/clientPortfolioRoutes.js"
import { registerClientAutoPaySipRoutes } from "../../src/routes/clientAutoPaySipRoutes.js"
import { registerPhonePeProviderEventRoutes } from "../../src/routes/phonePeProviderEventRoutes.js"
import { registerPhonePeMandateEventRoutes } from "../../src/routes/phonePeMandateEventRoutes.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"
const CALLBACK_AUTH = "Basic dGVzdDpzZWNyZXQ="
const MOBILE_TOKEN_KEY = randomBytes(32)
let recurringCreateCalls = 0
let recurringCancelCalls = 0
let recurringMerchantOrderId = ""
let recurringMerchantSubscriptionId = ""
let recurringAmountPaise = ""
let recurringSetupState: "PENDING" | "FAILED" | "COMPLETED" = "PENDING"
let recurringMandateState: "ACTIVATION_IN_PROGRESS" | "ACTIVE" | "PAUSED" | "CANCELLED" | "REVOKED" | "EXPIRED" | "FAILED" = "ACTIVATION_IN_PROGRESS"
let stubAutoPayEnabled = true
let recurringSetupStatusError: Error | null = null
let recurringCancelError: Error | null = null
let recurringCancelGate: Promise<void> | null = null
let recurringCancelStarted: (() => void) | null = null

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let unitOfWork: ReturnType<typeof createUnitOfWork>
let paymentsRepository: ReturnType<typeof createPaymentsRepository>
let settlementRepository: ReturnType<typeof createInvestmentSettlementRepository>
let refundRepository: ReturnType<typeof createRefundRepository>

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
let stubProviderState: string | null = null
let stubOrderStatusError: Error | null = null
let stubOrderStatusCalls = 0
let stubCheckoutGate: Promise<void> | null = null
let stubCheckoutStarted: (() => void) | null = null
let stubMobileOrderCalls: string[] = []
let stubMobileOrderError: Error | null = null
let stubMobileEnabled = true
let stubRefundOriginalMerchantOrderId: string | null = null
let stubRefundAmountPaise: string | null = null
const stubRefundInitiationIds = new Map<string, string | null>()

const stubMobileGateway: MobilePaymentGateway = {
  createSdkOrder: async (command) => {
    stubMobileOrderCalls.push(command.merchantOrderId)
    stubCheckoutStarted?.()
    if (stubCheckoutGate !== null) await stubCheckoutGate
    if (stubMobileOrderError !== null) throw stubMobileOrderError
    return {
      providerOrderId: `sdk_${command.merchantOrderId}`,
      providerState: "PENDING",
      sdkToken: `sdk-token-${command.merchantOrderId}`,
      expiresAt: new Date(Date.now() + 600_000),
    }
  },
}

const stubGateway: PaymentGateway = {
  getOrderStatus: (merchantOrderId): Promise<OrderStatusFact> => {
    stubOrderStatusCalls += 1
    if (stubOrderStatusError !== null) return Promise.reject(stubOrderStatusError)
    return Promise.resolve({
      merchantOrderId,
      outcome: stubOutcome,
      providerState: stubProviderState ?? (stubOutcome === "succeeded" ? "COMPLETED" : stubOutcome.toUpperCase()),
      providerOrderId: `sdk_${merchantOrderId}`,
      amountPaise: "1000000",
      currency: "INR",
      details: stubOutcome === "succeeded" ? [{
        transactionId: `transaction_${merchantOrderId}`,
        reference: "utr-test",
        instrumentType: "UPI",
        state: "COMPLETED",
        amountPaise: "1000000",
      }] : [],
    })
  },
  validateShaCallback: (authorizationHeader, rawBody): VerifiedCallback => {
    if (authorizationHeader !== CALLBACK_AUTH) throw new Error("bad auth")
    return JSON.parse(rawBody) as VerifiedCallback
  },
  initiateRefund: (command): Promise<RefundInitiated> => {
    stubRefundOriginalMerchantOrderId = command.originalMerchantOrderId
    stubRefundAmountPaise = command.amountPaise
    return Promise.resolve({
      providerRefundId: stubRefundInitiationIds.has(command.merchantRefundId)
        ? stubRefundInitiationIds.get(command.merchantRefundId) ?? null
        : `provrf_${command.merchantRefundId}`,
      outcome: "succeeded",
      providerState: "COMPLETED",
    })
  },
  getRefundStatus: (merchantRefundId): Promise<RefundStatusFact> => Promise.resolve({
    merchantRefundId,
    providerRefundId: `provrf_${merchantRefundId}`,
    originalMerchantOrderId: stubRefundOriginalMerchantOrderId,
    amountPaise: stubRefundAmountPaise,
    outcome: "succeeded",
    providerState: "COMPLETED",
  }),
}

const stubRecurringGateway: RecurringPaymentGateway = {
  createMandateSdkOrder: (command) => {
    recurringCreateCalls += 1
    recurringMerchantOrderId = command.merchantOrderId
    recurringMerchantSubscriptionId = command.merchantSubscriptionId
    recurringAmountPaise = command.amountPaise
    return Promise.resolve({
      providerOrderId: `provider_${command.merchantOrderId}`,
      providerState: "PENDING",
      sdkToken: `mandate_token_${command.merchantOrderId}`,
      expiresAt: new Date(Date.now() + 600_000),
    })
  },
  getSetupOrderStatus: (merchantOrderId) => recurringSetupStatusError === null
    ? Promise.resolve({
        state: recurringSetupState,
        providerOrderId: `provider_${merchantOrderId}`,
        merchantSubscriptionId: recurringMerchantSubscriptionId,
        providerSubscriptionId: recurringMandateState === "ACTIVATION_IN_PROGRESS" ? null : `subscription_${recurringMerchantSubscriptionId}`,
        paymentDetails: recurringSetupState === "COMPLETED" ? [{
          transactionId: `transaction_${merchantOrderId}`,
          state: "COMPLETED",
          amountPaise: recurringAmountPaise,
          instrumentType: "UPI_MANDATE",
        }] : [],
      })
    : Promise.reject(recurringSetupStatusError),
  getMandateStatus: (merchantSubscriptionId) => Promise.resolve({
    state: recurringMandateState,
    merchantSubscriptionId,
    providerSubscriptionId: recurringMandateState === "ACTIVATION_IN_PROGRESS" ? null : `subscription_${merchantSubscriptionId}`,
  }),
  notifyCollection: () => Promise.reject(new Error("unused")),
  getCollectionStatus: () => Promise.reject(new Error("unused")),
  cancelMandate: async () => {
    recurringCancelCalls += 1
    recurringCancelStarted?.()
    if (recurringCancelGate !== null) await recurringCancelGate
    if (recurringCancelError !== null) throw recurringCancelError
  },
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
  unitOfWork = createUnitOfWork(database)

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

  paymentsRepository = createPaymentsRepository()
  settlementRepository = createInvestmentSettlementRepository()
  refundRepository = createRefundRepository()
  const acknowledgementRepository = createFundReceiptAcknowledgementRepository()
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
        mobilePaymentGateway: stubMobileGateway,
        config: {
          idempotencyTtlMs: 86_400_000,
          attemptTtlMs: 900_000,
          mobileSdk: {
            get enabled() { return stubMobileEnabled },
            merchantId: "PHONEPE_MERCHANT",
            environment: "SANDBOX",
            tokenEncryptionKey: MOBILE_TOKEN_KEY,
            tokenKeyVersion: "ptk1",
          },
        },
      })
      registerClientPortfolioRoutes(instance, {
        accessTokenService,
        database,
        clientPortfolioRepository: createClientPortfolioRepository(),
        clientValueEntryRepository: createClientValueEntryRepository(),
        unitOfWork,
        clock: () => new Date(),
        config: { cursorKey: randomBytes(32) },
      })
      registerClientAutoPaySipRoutes(instance, {
        accessTokenService,
        database,
        unitOfWork,
        clock: () => new Date(),
        sipPlanRepository: createSipPlanRepository(),
        mandatesRepository: createMandatesRepository(),
        orderRepository: createOrderRepository(),
        paymentsRepository,
        userRepository: createUserRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
        recurringPaymentGateway: stubRecurringGateway,
        config: {
          get enabled() { return stubAutoPayEnabled },
          idempotencyTtlMs: 86_400_000,
          attemptTtlMs: 900_000,
          merchantId: "PHONEPE_MERCHANT",
          environment: "SANDBOX",
          tokenEncryptionKey: MOBILE_TOKEN_KEY,
          tokenKeyVersion: "ptk1",
        },
      })
      registerPhonePeProviderEventRoutes(instance, {
        unitOfWork,
        clock: () => new Date(),
        paymentGateway: stubGateway,
        config: {
          payloadEncryptionKey: randomBytes(32),
          payloadKeyVersion: "ek1",
          paymentEventAllowlist: ["checkout.order.completed", "checkout.order.failed"],
          refundEventAllowlist: ["pg.refund.completed", "pg.refund.failed"],
        },
        providerEventInboxRepository,
        paymentsRepository,
        settlementRepository,
        refundRepository,
      })
      registerPhonePeMandateEventRoutes(instance, {
        unitOfWork,
        clock: () => new Date(),
        paymentGateway: stubGateway,
        recurringPaymentGateway: stubRecurringGateway,
        mandatesRepository: createMandatesRepository(),
        paymentsRepository,
        settlementRepository,
        providerEventInboxRepository,
        config: {
          payloadEncryptionKey: randomBytes(32),
          payloadKeyVersion: "ek1",
          merchantId: "PHONEPE_MERCHANT",
          eventAllowlist: [
            "subscription.status.updated",
            "checkout.setup.order.completed",
            "checkout.setup.order.failed",
          ],
        },
      })
      registerAdminFundReceiptRoutes(instance, {
        webAuth,
        unitOfWork,
        database,
        clock: () => new Date(),
        config: { idempotencyTtlMs: 86_400_000 },
        acknowledgementRepository,
        paymentsRepository,
        settlementRepository,
        refundRepository,
        paymentGateway: stubGateway,
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
        notificationRepository: createNotificationRepository(),
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

const createActiveAutoPay = async (
  token: string,
  fundId: string,
): Promise<Readonly<{ sipPlanId: string }>> => {
  recurringSetupState = "PENDING"
  recurringMandateState = "ACTIVATION_IN_PROGRESS"
  recurringSetupStatusError = null
  const create = await app.inject({
    method: "POST",
    url: "/v1/client/sips/autopay",
    headers: { ...bearer(token), "idempotency-key": `autopay-cancel-create-${randomUUID()}` },
    payload: { fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
  })
  expect(create.statusCode, create.body).toBe(201)
  const created = dataOf<{ sipPlanId: string }>(create)
  recurringSetupState = "COMPLETED"
  recurringMandateState = "ACTIVE"
  const callback = await app.inject({
    method: "POST",
    url: "/v1/provider-events/phonepe/subscription",
    headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
    payload: JSON.stringify({
      event: "checkout.setup.order.completed",
      payload: {
        state: "COMPLETED",
        merchantId: "PHONEPE_MERCHANT",
        merchantOrderId: recurringMerchantOrderId,
        paymentFlow: {
          type: "SUBSCRIPTION_CHECKOUT_SETUP",
          subscriptionDetails: { merchantSubscriptionId: recurringMerchantSubscriptionId },
        },
      },
    }),
  })
  expect(callback.statusCode, callback.body).toBe(200)
  return created
}

const runMandateWorker = (clock: () => Date = () => new Date()) => runMandateReconciliationPass({
  unitOfWork,
  clock,
  recurringPaymentGateway: stubRecurringGateway,
  mandatesRepository: createMandatesRepository(),
  paymentsRepository,
  settlementRepository,
  config: { claimLimit: 100, notFoundGraceMs: 60_000 },
})

describe("checkout orchestrator", () => {
  test("creates an AutoPay mandate setup through the canonical first installment and replays one encrypted SDK order", async () => {
    const { userId, token } = await seedClientToken(`autopay-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`autopay-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)
    const key = `autopay-${randomUUID()}`
    const beforeCalls = recurringCreateCalls
    const create = await app.inject({
      method: "POST",
      url: "/v1/client/sips/autopay",
      headers: { ...bearer(token), "idempotency-key": key },
      payload: { fundId: fund.fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
    })
    expect(create.statusCode, create.body).toBe(201)
    const created = dataOf<{
      sipPlanId: string
      mandateId: string
      orderId: string
      paymentId: string
      checkout: { type: string; token: string; providerOrderId: string }
    }>(create)
    expect(created.checkout.type).toBe("phonepe_sdk")
    expect(recurringCreateCalls - beforeCalls).toBe(1)

    const rows = await pool.query<{
      sip_state: string
      mandate_state: string
      order_type: string
      order_state: string
      payment_state: string
      attempt_state: string
      checkout_channel: string
      sdk_order_token_ciphertext: Buffer | null
      response_body: unknown
    }>(
      "select sip.state sip_state, mandate.state mandate_state, investment_order.type order_type, " +
        "investment_order.state order_state, payment.state payment_state, attempt.state attempt_state, " +
        "attempt.checkout_channel, setup.sdk_order_token_ciphertext, idem.response_body " +
        "from sip_plans sip join payment_mandates mandate on mandate.sip_plan_id = sip.id " +
        "join mandate_setup_attempts setup on setup.mandate_id = mandate.id " +
        "join investment_orders investment_order on investment_order.id = setup.order_id " +
        "join payments payment on payment.id = setup.payment_id " +
        "join payment_attempts attempt on attempt.id = setup.payment_attempt_id " +
        "join idempotency_records idem on idem.actor_scope = $2 and idem.key = $3 where sip.id = $1",
      [created.sipPlanId, `user:${userId}`, key],
    )
    expect(rows.rows[0]).toMatchObject({
      sip_state: "pending_mandate",
      mandate_state: "setup_pending",
      order_type: "sip_installment",
      order_state: "payment_pending",
      payment_state: "provider_pending",
      attempt_state: "provider_pending",
      checkout_channel: "phonepe_mandate_setup",
    })
    expect(rows.rows[0]?.sdk_order_token_ciphertext).toBeInstanceOf(Buffer)
    expect(JSON.stringify(rows.rows[0]?.response_body)).not.toContain(created.checkout.token)

    const replay = await app.inject({
      method: "POST",
      url: "/v1/client/sips/autopay",
      headers: { ...bearer(token), "idempotency-key": key },
      payload: { fundId: fund.fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
    })
    expect(replay.statusCode).toBe(200)

    expect(dataOf<{ checkout: { token: string } }>(replay).checkout.token).toBe(created.checkout.token)
    expect(recurringCreateCalls - beforeCalls).toBe(1)
  })

  test("keeps provider reconciliation live while AutoPay commands are disabled", async () => {
    stubAutoPayEnabled = true
    recurringSetupState = "PENDING"
    recurringMandateState = "ACTIVATION_IN_PROGRESS"
    const { token } = await seedClientToken(`autopay-disabled-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`autopay-disabled-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)
    const create = await app.inject({
      method: "POST",
      url: "/v1/client/sips/autopay",
      headers: { ...bearer(token), "idempotency-key": `autopay-disabled-create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
    })
    expect(create.statusCode, create.body).toBe(201)
    const created = dataOf<{ sipPlanId: string }>(create)

    stubAutoPayEnabled = false
    const blockedCreate = await app.inject({
      method: "POST",
      url: "/v1/client/sips/autopay",
      headers: { ...bearer(token), "idempotency-key": `autopay-disabled-blocked-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
    })
    expect(blockedCreate.statusCode).toBe(409)

    recurringSetupState = "COMPLETED"
    recurringMandateState = "ACTIVE"
    const repaired = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/subscription",
      headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
      payload: JSON.stringify({
        event: "checkout.setup.order.completed",
        payload: {
          state: "COMPLETED",
          merchantId: "PHONEPE_MERCHANT",
          merchantOrderId: recurringMerchantOrderId,
          paymentFlow: {
            type: "SUBSCRIPTION_CHECKOUT_SETUP",
            subscriptionDetails: { merchantSubscriptionId: recurringMerchantSubscriptionId },
          },
        },
      }),
    })
    expect(repaired.statusCode, repaired.body).toBe(200)
    expect((await pool.query<{ state: string }>("select state from sip_plans where id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("active")

    recurringMandateState = "PAUSED"
    await runMandateReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      recurringPaymentGateway: stubRecurringGateway,
      mandatesRepository: createMandatesRepository(),
      paymentsRepository,
      settlementRepository,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect((await pool.query<{ state: string }>("select state from sip_plans where id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("paused")

    const cancelCallsBefore = recurringCancelCalls
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/client/sips/autopay/${created.sipPlanId}/cancel`,
      headers: { ...bearer(token), "idempotency-key": `autopay-disabled-cancel-${randomUUID()}` },
    })
    expect(cancel.statusCode, cancel.body).toBe(202)
    await runMandateWorker()
    expect(recurringCancelCalls).toBe(cancelCallsBefore + 1)

    recurringMandateState = "CANCELLED"
    await runMandateReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      recurringPaymentGateway: stubRecurringGateway,
      mandatesRepository: createMandatesRepository(),
      paymentsRepository,
      settlementRepository,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect((await pool.query<{ state: string }>("select state from sip_plans where id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("cancelled")
    stubAutoPayEnabled = true
  })

  test("activates AutoPay only after both the setup debit succeeds and the subscription is active", async () => {
    recurringSetupState = "PENDING"
    recurringMandateState = "ACTIVATION_IN_PROGRESS"
    const { token } = await seedClientToken(`autopay-gate-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`autopay-gate-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)
    const create = await app.inject({
      method: "POST",
      url: "/v1/client/sips/autopay",
      headers: { ...bearer(token), "idempotency-key": `autopay-gate-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
    })
    expect(create.statusCode, create.body).toBe(201)
    const created = dataOf<{ sipPlanId: string; orderId: string }>(create)

    recurringMandateState = "ACTIVE"
    const activeFirst = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/subscription",
      headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
      payload: JSON.stringify({
        event: "subscription.status.updated",
        payload: {
          state: "ACTIVE",
          merchantId: "PHONEPE_MERCHANT",
          merchantSubscriptionId: recurringMerchantSubscriptionId,
        },
      }),
    })
    expect(activeFirst.statusCode).toBe(200)
    expect((await pool.query<{ state: string }>("select state from sip_plans where id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("pending_mandate")

    recurringSetupState = "COMPLETED"
    const setupCompletePayload = JSON.stringify({
      event: "checkout.setup.order.completed",
      payload: {
        state: "COMPLETED",
        merchantId: "PHONEPE_MERCHANT",
        merchantOrderId: recurringMerchantOrderId,
        paymentFlow: {
          type: "SUBSCRIPTION_CHECKOUT_SETUP",
          subscriptionDetails: { merchantSubscriptionId: recurringMerchantSubscriptionId },
        },
      },
    })
    const setupComplete = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/subscription",
      headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
      payload: setupCompletePayload,
    })
    expect(setupComplete.statusCode, setupComplete.body).toBe(200)
    const truth = await pool.query<{
      sip_state: string
      mandate_state: string
      payment_state: string
      order_state: string
      reviews: string
    }>(
      "select sip.state sip_state, mandate.state mandate_state, payment.state payment_state, " +
        "investment_order.state order_state, count(review.id)::text reviews from sip_plans sip " +
        "join payment_mandates mandate on mandate.sip_plan_id = sip.id " +
        "join investment_orders investment_order on investment_order.sip_plan_id = sip.id " +
        "join payments payment on payment.order_id = investment_order.id " +
        "left join fund_receipt_acknowledgements review on review.order_id = investment_order.id " +
        "where sip.id = $1 group by sip.state, mandate.state, payment.state, investment_order.state",
      [created.sipPlanId],
    )
    expect(truth.rows[0]).toEqual({
      sip_state: "active",
      mandate_state: "active",
      payment_state: "succeeded",
      order_state: "accepted",
      reviews: "1",
    })

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/subscription",
      headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
      payload: setupCompletePayload,
    })
    expect(duplicate.statusCode).toBe(200)
    expect((await pool.query<{ count: string }>("select count(*) from fund_receipt_acknowledgements where order_id = $1", [created.orderId])).rows[0]?.count)
      .toBe("1")

    const cancelKey = `autopay-cancel-${randomUUID()}`
    const cancelCallsBefore = recurringCancelCalls
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/client/sips/autopay/${created.sipPlanId}/cancel`,
      headers: { ...bearer(token), "idempotency-key": cancelKey },
    })
    expect(cancel.statusCode).toBe(202)
    expect(dataOf<{ status: string }>(cancel).status).toBe("cancel_pending")
    expect(recurringCancelCalls - cancelCallsBefore).toBe(0)
    expect((await pool.query<{ state: string }>("select state from payment_mandates where sip_plan_id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("cancel_pending")
    const replayCancel = await app.inject({
      method: "POST",
      url: `/v1/client/sips/autopay/${created.sipPlanId}/cancel`,
      headers: { ...bearer(token), "idempotency-key": cancelKey },
    })
    expect(replayCancel.statusCode).toBe(202)
    expect(recurringCancelCalls - cancelCallsBefore).toBe(0)
    expect((await pool.query<{ state: string }>("select state from mandate_cancel_commands where sip_plan_id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("queued")
    const dispatched = await runMandateReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      recurringPaymentGateway: stubRecurringGateway,
      mandatesRepository: createMandatesRepository(),
      paymentsRepository,
      settlementRepository,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect(dispatched.cancelCommandsDispatched).toBeGreaterThanOrEqual(1)
    expect(recurringCancelCalls - cancelCallsBefore).toBe(1)
    expect((await pool.query<{ state: string }>("select state from mandate_cancel_commands where sip_plan_id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("accepted")
    recurringMandateState = "CANCELLED"
    const reconciled = await runMandateReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      recurringPaymentGateway: stubRecurringGateway,
      mandatesRepository: createMandatesRepository(),
      paymentsRepository,
      settlementRepository,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect(reconciled.mandatesResolved).toBeGreaterThanOrEqual(1)
    expect((await pool.query<{ state: string }>("select state from payment_mandates where sip_plan_id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("cancelled")
    expect((await pool.query<{ state: string }>("select state from sip_plans where id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("cancelled")
    const detail = await app.inject({
      method: "GET",
      url: `/v1/client/sips/autopay/${created.sipPlanId}`,
      headers: bearer(token),
    })
    expect(detail.statusCode, detail.body).toBe(200)
    expect(dataOf<{ mandate: { status: string } }>(detail).mandate.status).toBe("cancelled")
  })

  test("restores the active mandate after a definite cancellation rejection", async () => {
    stubAutoPayEnabled = true
    recurringCancelError = null
    recurringCancelGate = null
    const { token } = await seedClientToken(`autopay-cancel-reject-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`autopay-cancel-reject-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)
    const created = await createActiveAutoPay(token, fund.fundId)
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/client/sips/autopay/${created.sipPlanId}/cancel`,
      headers: { ...bearer(token), "idempotency-key": `autopay-cancel-reject-${randomUUID()}` },
    })
    expect(cancel.statusCode, cancel.body).toBe(202)
    const callsBefore = recurringCancelCalls
    recurringCancelError = new GatewayRejectedError("provider rejected")
    await runMandateWorker()
    expect(recurringCancelCalls - callsBefore).toBe(1)
    expect((await pool.query<{ mandate_state: string; sip_state: string; command_state: string }>(
      "select mandate.state mandate_state, sip.state sip_state, command.state command_state " +
        "from payment_mandates mandate join sip_plans sip on sip.id = mandate.sip_plan_id " +
        "join mandate_cancel_commands command on command.mandate_id = mandate.id where sip.id = $1",
      [created.sipPlanId],
    )).rows[0]).toEqual({ mandate_state: "active", sip_state: "active", command_state: "rejected" })
    recurringCancelError = null
  })

  test("reconciles an ambiguous cancellation without dispatching it twice", async () => {
    stubAutoPayEnabled = true
    recurringCancelError = null
    recurringCancelGate = null
    const { token } = await seedClientToken(`autopay-cancel-ambiguous-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`autopay-cancel-ambiguous-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)
    const created = await createActiveAutoPay(token, fund.fundId)
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/client/sips/autopay/${created.sipPlanId}/cancel`,
      headers: { ...bearer(token), "idempotency-key": `autopay-cancel-ambiguous-${randomUUID()}` },
    })
    expect(cancel.statusCode, cancel.body).toBe(202)
    const callsBefore = recurringCancelCalls
    recurringCancelError = new GatewayUnavailableError("timeout")
    await runMandateWorker()
    expect(recurringCancelCalls - callsBefore).toBe(1)
    expect((await pool.query<{ state: string }>("select state from mandate_cancel_commands where sip_plan_id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("dispatching")

    recurringCancelError = null
    recurringMandateState = "ACTIVE"
    const dispatchStarted = await pool.query<{ dispatch_started_at: Date }>(
      "select dispatch_started_at from mandate_cancel_commands where sip_plan_id = $1",
      [created.sipPlanId],
    )
    const startedAt = dispatchStarted.rows[0]!.dispatch_started_at
    await runMandateWorker(() => new Date(startedAt.getTime() + 30_000))
    await runMandateWorker(() => new Date(startedAt.getTime() + 60_001))
    expect(recurringCancelCalls - callsBefore).toBe(1)
    expect((await pool.query<{ state: string; status_check_count: number }>(
      "select state, status_check_count from mandate_cancel_commands where sip_plan_id = $1",
      [created.sipPlanId],
    )).rows[0]).toEqual({ state: "reconciliation_required", status_check_count: 2 })
    const detail = await app.inject({
      method: "GET",
      url: `/v1/client/sips/autopay/${created.sipPlanId}`,
      headers: bearer(token),
    })
    expect(dataOf<{ cancellation: { status: string; failureCode: string } }>(detail).cancellation)
      .toEqual({ status: "reconciliation_required", failureCode: "PROVIDER_STILL_ACTIVE" })

    recurringMandateState = "CANCELLED"
    await runMandateWorker()
    expect(recurringCancelCalls - callsBefore).toBe(1)
    expect((await pool.query<{ mandate_state: string; sip_state: string; command_state: string }>(
      "select mandate.state mandate_state, sip.state sip_state, command.state command_state " +
        "from payment_mandates mandate join sip_plans sip on sip.id = mandate.sip_plan_id " +
        "join mandate_cancel_commands command on command.mandate_id = mandate.id where sip.id = $1",
      [created.sipPlanId],
    )).rows[0]).toEqual({ mandate_state: "cancelled", sip_state: "cancelled", command_state: "accepted" })
  })

  test("claims one cancellation dispatch under concurrent worker passes", async () => {
    stubAutoPayEnabled = true
    recurringCancelError = null
    const { token } = await seedClientToken(`autopay-cancel-race-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`autopay-cancel-race-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)
    const created = await createActiveAutoPay(token, fund.fundId)
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/client/sips/autopay/${created.sipPlanId}/cancel`,
      headers: { ...bearer(token), "idempotency-key": `autopay-cancel-race-${randomUUID()}` },
    })
    expect(cancel.statusCode, cancel.body).toBe(202)
    let releaseCancel = (): void => undefined
    let markCancelStarted = (): void => undefined
    recurringCancelGate = new Promise<void>((resolve) => { releaseCancel = resolve })
    const cancelStarted = new Promise<void>((resolve) => { markCancelStarted = resolve })
    recurringCancelStarted = markCancelStarted
    const callsBefore = recurringCancelCalls
    const first = runMandateWorker()
    await cancelStarted
    const second = runMandateWorker()
    releaseCancel()
    await Promise.all([first, second])
    expect(recurringCancelCalls - callsBefore).toBe(1)
    expect((await pool.query<{ state: string }>("select state from mandate_cancel_commands where sip_plan_id = $1", [created.sipPlanId])).rows[0]?.state)
      .toBe("accepted")
    recurringCancelGate = null
    recurringCancelStarted = null
  })

  test("preserves a successful setup debit for review when mandate activation fails", async () => {
    recurringSetupState = "PENDING"
    recurringMandateState = "ACTIVATION_IN_PROGRESS"
    const { token } = await seedClientToken(`autopay-failed-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`autopay-failed-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)
    const create = await app.inject({
      method: "POST",
      url: "/v1/client/sips/autopay",
      headers: { ...bearer(token), "idempotency-key": `autopay-failed-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
    })
    expect(create.statusCode, create.body).toBe(201)
    const created = dataOf<{ sipPlanId: string }>(create)
    recurringSetupState = "COMPLETED"
    recurringMandateState = "FAILED"
    const callback = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/subscription",
      headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
      payload: JSON.stringify({
        event: "checkout.setup.order.completed",
        payload: {
          state: "COMPLETED",
          merchantId: "PHONEPE_MERCHANT",
          merchantOrderId: recurringMerchantOrderId,
          paymentFlow: {
            type: "SUBSCRIPTION_CHECKOUT_SETUP",
            subscriptionDetails: { merchantSubscriptionId: recurringMerchantSubscriptionId },
          },
        },
      }),
    })
    expect(callback.statusCode, callback.body).toBe(200)
    const truth = await pool.query<{ sip_state: string; mandate_state: string; payment_state: string; order_state: string }>(
      "select sip.state sip_state, mandate.state mandate_state, payment.state payment_state, investment_order.state order_state " +
        "from sip_plans sip join payment_mandates mandate on mandate.sip_plan_id = sip.id " +
        "join investment_orders investment_order on investment_order.sip_plan_id = sip.id " +
        "join payments payment on payment.order_id = investment_order.id where sip.id = $1",
      [created.sipPlanId],
    )
    expect(truth.rows[0]).toEqual({
      sip_state: "setup_failed",
      mandate_state: "failed",
      payment_state: "succeeded",
      order_state: "accepted",
    })
  })

  test("creates one fresh setup attempt only after an authoritative unpaid failure", async () => {
    recurringSetupState = "PENDING"
    recurringMandateState = "ACTIVATION_IN_PROGRESS"
    const { token } = await seedClientToken(`autopay-retry-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`autopay-retry-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)
    const create = await app.inject({
      method: "POST",
      url: "/v1/client/sips/autopay",
      headers: { ...bearer(token), "idempotency-key": `autopay-retry-create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
    })
    expect(create.statusCode, create.body).toBe(201)
    const created = dataOf<{ sipPlanId: string }>(create)
    recurringSetupState = "FAILED"
    const failed = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/subscription",
      headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
      payload: JSON.stringify({
        event: "checkout.setup.order.failed",
        payload: {
          state: "FAILED",
          merchantId: "PHONEPE_MERCHANT",
          merchantOrderId: recurringMerchantOrderId,
          paymentFlow: {
            type: "SUBSCRIPTION_CHECKOUT_SETUP",
            subscriptionDetails: { merchantSubscriptionId: recurringMerchantSubscriptionId },
          },
        },
      }),
    })
    expect(failed.statusCode, failed.body).toBe(200)
    const failedTruth = await pool.query(
      "select sip.state sip_state, mandate.state mandate_state, investment_order.state order_state, " +
        "payment.state payment_state, setup.state setup_state from sip_plans sip " +
        "join payment_mandates mandate on mandate.sip_plan_id = sip.id " +
        "join mandate_setup_attempts setup on setup.mandate_id = mandate.id " +
        "join investment_orders investment_order on investment_order.id = setup.order_id " +
        "join payments payment on payment.id = setup.payment_id where sip.id = $1",
      [created.sipPlanId],
    )
    expect(failedTruth.rows[0]).toEqual({
      sip_state: "pending_mandate",
      mandate_state: "setup_pending",
      order_state: "payment_failed",
      payment_state: "failed",
      setup_state: "failed",
    })
    const detail = await app.inject({
      method: "GET",
      url: `/v1/client/sips/autopay/${created.sipPlanId}`,
      headers: bearer(token),
    })
    expect(detail.statusCode, detail.body).toBe(200)
    expect(dataOf<{
      canRetrySetup: boolean
      setup: { status: string; failureCode: string | null }
    }>(detail)).toMatchObject({
      canRetrySetup: true,
      setup: { status: "failed" },
    })
    const callsBefore = recurringCreateCalls
    recurringSetupState = "PENDING"
    const retryKey = `autopay-retry-${randomUUID()}`
    const retry = await app.inject({
      method: "POST",
      url: `/v1/client/sips/autopay/${created.sipPlanId}/setup/retry`,
      headers: { ...bearer(token), "idempotency-key": retryKey },
    })
    expect(retry.statusCode, retry.body).toBe(201)
    expect(recurringCreateCalls - callsBefore).toBe(1)
    const counts = await pool.query<{ setups: string; attempts: string }>(
      "select count(distinct setup.id)::text setups, count(distinct attempt.id)::text attempts " +
        "from mandate_setup_attempts setup join payment_attempts attempt on attempt.payment_id = setup.payment_id " +
        "where setup.sip_plan_id = $1",
      [created.sipPlanId],
    )
    expect(counts.rows[0]).toEqual({ setups: "2", attempts: "2" })
    const replay = await app.inject({
      method: "POST",
      url: `/v1/client/sips/autopay/${created.sipPlanId}/setup/retry`,
      headers: { ...bearer(token), "idempotency-key": retryKey },
    })
    expect(replay.statusCode).toBe(200)
    expect(recurringCreateCalls - callsBefore).toBe(1)
  })

  test("expires undispatched and authoritative-not-found setup attempts without another provider POST", async () => {
    stubAutoPayEnabled = true
    recurringSetupState = "PENDING"
    recurringMandateState = "ACTIVATION_IN_PROGRESS"
    recurringSetupStatusError = null
    const { token } = await seedClientToken(`autopay-expiry-${randomUUID().slice(0, 8)}@example.com`)
    const admin = await pool.query<{ id: string }>("select id from users where email_normalized = $1", [
      "payrev-finance@example.com",
    ])
    const fund = await seedPublishedFund(`autopay-expiry-${randomUUID().slice(0, 8)}`, admin.rows[0]!.id)
    const createPlan = async () => dataOf<{ sipPlanId: string }>(await app.inject({
      method: "POST",
      url: "/v1/client/sips/autopay",
      headers: { ...bearer(token), "idempotency-key": `autopay-expiry-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "50000", debitDay: 5, durationMonths: 12 },
    }))
    const undispatched = await createPlan()
    const ambiguous = await createPlan()
    const now = new Date()
    await pool.query(
      "update mandate_setup_attempts set state = 'created', provider_order_id = null, provider_dispatch_started_at = null, " +
        "sdk_order_token_ciphertext = null, sdk_order_token_nonce = null, sdk_order_token_key_version = null, " +
        "sdk_order_token_expires_at = null, setup_expires_at = $2 where sip_plan_id = $1",
      [undispatched.sipPlanId, new Date(now.getTime() - 1)],
    )
    await pool.query(
      "update payment_attempts attempt set state = 'created', provider_order_id = null, provider_dispatch_started_at = null, " +
        "provider_state = null from mandate_setup_attempts setup where setup.payment_attempt_id = attempt.id and setup.sip_plan_id = $1",
      [undispatched.sipPlanId],
    )
    await pool.query(
      "update payments payment set state = 'created' from mandate_setup_attempts setup where setup.payment_id = payment.id and setup.sip_plan_id = $1",
      [undispatched.sipPlanId],
    )
    await pool.query("update mandate_setup_attempts set setup_expires_at = $2 where sip_plan_id = $1", [
      ambiguous.sipPlanId,
      new Date(now.getTime() - 1),
    ])
    const createCallsBefore = recurringCreateCalls
    recurringSetupStatusError = new GatewayNotFoundError("not found")
    await runMandateReconciliationPass({
      unitOfWork,
      clock: () => now,
      recurringPaymentGateway: stubRecurringGateway,
      mandatesRepository: createMandatesRepository(),
      paymentsRepository,
      settlementRepository,
      config: { claimLimit: 100, notFoundGraceMs: 60_000 },
    })
    expect((await pool.query<{ state: string }>("select state from mandate_setup_attempts where sip_plan_id = $1", [undispatched.sipPlanId])).rows[0]?.state)
      .toBe("expired")
    expect((await pool.query<{ state: string }>("select state from mandate_setup_attempts where sip_plan_id = $1", [ambiguous.sipPlanId])).rows[0]?.state)
      .toBe("provider_pending")

    await runMandateReconciliationPass({
      unitOfWork,
      clock: () => new Date(now.getTime() + 60_001),
      recurringPaymentGateway: stubRecurringGateway,
      mandatesRepository: createMandatesRepository(),
      paymentsRepository,
      settlementRepository,
      config: { claimLimit: 100, notFoundGraceMs: 60_000 },
    })
    expect((await pool.query<{ setup_state: string; payment_state: string }>(
      "select setup.state setup_state, payment.state payment_state from mandate_setup_attempts setup " +
        "join payments payment on payment.id = setup.payment_id where setup.sip_plan_id = $1",
      [ambiguous.sipPlanId],
    )).rows[0]).toEqual({ setup_state: "expired", payment_state: "expired" })
    expect(recurringCreateCalls).toBe(createCallsBefore)
    recurringSetupStatusError = null
  })

  test("creates an order, dispatches a mobile checkout, and reuses the same attempt on retry", async () => {
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
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(pay.statusCode).toBe(200)
    const payBody = dataOf<{ checkout: { type: string; token: string } }>(pay)
    expect(payBody.checkout.type).toBe("phonepe_sdk")
    expect(payBody.checkout.token).toMatch(/^sdk-token-/u)

    const attempts = await pool.query<{ count: string }>(
      "select count(*) as count from payment_attempts where user_id = $1",
      [userId],
    )
    expect(Number(attempts.rows[0]!.count)).toBe(1)

    await pool.query(
      "update payment_attempts set checkout_expires_at = now() + interval '6 minutes' where user_id = $1",
      [userId],
    )
    const retryKey = `pay-retry-${randomUUID()}`
    const retry = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": retryKey },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(retry.statusCode).toBe(200)
    expect(dataOf<{ checkout: { token: string } }>(retry).checkout.token).toBe(payBody.checkout.token)
    const attemptsAfterRetry = await pool.query<{ count: string }>(
      "select count(*) as count from payment_attempts where user_id = $1",
      [userId],
    )
    expect(Number(attemptsAfterRetry.rows[0]!.count)).toBe(1)

    await pool.query(
      "update payment_attempts set checkout_expires_at = now() - interval '1 second' where user_id = $1",
      [userId],
    )
    const afterExpiry = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `pay-after-expiry-${randomUUID()}` },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(afterExpiry.statusCode).toBe(409)
    expect(errorOf(afterExpiry)).toBe("STATE_CONFLICT")

    const attemptsAfterExpiry = await pool.query<{ state: string; checkout_expires_at: Date }>(
      "select state, checkout_expires_at from payment_attempts where user_id = $1 order by attempt_number",
      [userId],
    )
    expect(attemptsAfterExpiry.rows.map((row) => row.state)).toEqual(["provider_pending"])

    const attemptIdentity = await pool.query<{ id: string; payment_id: string }>(
      "select id, payment_id from payment_attempts where user_id = $1",
      [userId],
    )
    const warnings: Record<string, unknown>[] = []
    stubOrderStatusError = new GatewayUnavailableError("provider unavailable")
    const unavailable = await runReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      paymentGateway: stubGateway,
      paymentsRepository,
      settlementRepository,
      refundRepository,
      logger: { warn: (fields) => warnings.push(fields) },
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect(unavailable.attemptsResolved).toBe(0)
    expect(warnings[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(warnings[0]?.requestId).not.toBe(attemptIdentity.rows[0]!.id)
    await pool.query(
      "update payment_attempts set next_status_check_at = null, reconciliation_lease_expires_at = null where id = $1",
      [attemptIdentity.rows[0]!.id],
    )

    stubOrderStatusError = new GatewayNotFoundError("provider reference not found")
    const earlyNotFound = await runReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      paymentGateway: stubGateway,
      paymentsRepository,
      settlementRepository,
      refundRepository,
      logger: null,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect(earlyNotFound.attemptsResolved).toBe(0)
    await pool.query(
      "update payment_attempts set next_status_check_at = null, reconciliation_lease_expires_at = null where id = $1",
      [attemptIdentity.rows[0]!.id],
    )

    stubOrderStatusError = null
    stubOutcome = "pending"
    const ambiguous = await runReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      paymentGateway: stubGateway,
      paymentsRepository,
      settlementRepository,
      refundRepository,
      logger: null,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect(ambiguous.attemptsResolved).toBe(0)
    await pool.query(
      "update payment_attempts set next_status_check_at = null, reconciliation_lease_expires_at = null where id = $1",
      [attemptIdentity.rows[0]!.id],
    )

    stubProviderState = "EXPIRED"
    const expired = await runReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      paymentGateway: stubGateway,
      paymentsRepository,
      settlementRepository,
      refundRepository,
      logger: null,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect(expired.attemptsResolved).toBe(1)
    stubProviderState = null
    stubOutcome = "succeeded"

    const resolvedAttempt = await pool.query<{ state: string; provider_state: string }>(
      "select state, provider_state from payment_attempts where id = $1",
      [attemptIdentity.rows[0]!.id],
    )
    expect(resolvedAttempt.rows[0]).toMatchObject({ state: "expired", provider_state: "EXPIRED" })

    const retryAfterResolution = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `pay-after-resolution-${randomUUID()}` },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(retryAfterResolution.statusCode).toBe(200)
    const retryState = await pool.query<{ payment_state: string; attempt_states: string[] }>(
      "select p.state as payment_state, array_agg(a.state::text order by a.attempt_number) as attempt_states " +
        "from payments p join payment_attempts a on a.payment_id = p.id where p.order_id = $1 group by p.state",
      [orderId],
    )
    expect(retryState.rows[0]).toMatchObject({
      payment_state: "provider_pending",
      attempt_states: ["expired", "provider_pending"],
    })

    await pool.query(
      "update payment_attempts set checkout_expires_at = now() - interval '61 seconds' " +
        "where user_id = $1 and state = 'provider_pending'",
      [userId],
    )
    stubOrderStatusError = new GatewayNotFoundError("provider reference not found")
    const notFound = await runReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      paymentGateway: stubGateway,
      paymentsRepository,
      settlementRepository,
      refundRepository,
      logger: null,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect(notFound.attemptsResolved).toBe(1)
    stubOrderStatusError = null
    const finalAttempts = await pool.query<{ state: string; provider_state: string }>(
      "select state, provider_state from payment_attempts where user_id = $1 order by attempt_number",
      [userId],
    )
    expect(finalAttempts.rows).toEqual([
      expect.objectContaining({ state: "expired", provider_state: "EXPIRED" }),
      expect.objectContaining({ state: "expired", provider_state: "NOT_FOUND" }),
    ])
  })

  test("persists and replays a mobile SDK token only through its encrypted attempt envelope", async () => {
    const { userId, token } = await seedClientToken(`client-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await seedPublishedFund(`pay-mobile-${randomUUID().slice(0, 8)}`, financeAdminId)
    const created = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: { ...bearer(token), "idempotency-key": `create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "1000000" },
    })
    const orderId = dataOf<{ orderId: string }>(created).orderId
    const payKey = `mobile-${randomUUID()}`
    stubMobileOrderCalls = []

    const first = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": payKey },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(first.statusCode).toBe(200)
    const firstBody = dataOf<{
      checkout: { type: string; providerOrderId: string; token: string; merchantId: string; environment: string }
    }>(first)
    expect(firstBody.checkout).toMatchObject({
      type: "phonepe_sdk",
      merchantId: "PHONEPE_MERCHANT",
      environment: "SANDBOX",
    })
    expect(stubMobileOrderCalls).toHaveLength(1)

    const attempt = await pool.query<{
      id: string
      merchant_order_id: string
      checkout_channel: string
      provider_order_id: string
      sdk_order_token_ciphertext: Buffer
      sdk_order_token_nonce: Buffer
      sdk_order_token_key_version: string
      sdk_order_token_expires_at: Date
    }>(
      "select id, merchant_order_id, checkout_channel, provider_order_id, sdk_order_token_ciphertext, " +
        "sdk_order_token_nonce, sdk_order_token_key_version, sdk_order_token_expires_at " +
        "from payment_attempts where user_id = $1",
      [userId],
    )
    const row = attempt.rows[0]!
    expect(row.checkout_channel).toBe("phonepe_mobile_sdk")
    expect(row.provider_order_id).toBe(firstBody.checkout.providerOrderId)
    expect(row.sdk_order_token_key_version).toBe("ptk1")
    expect(decryptGcm(
      MOBILE_TOKEN_KEY,
      row.sdk_order_token_ciphertext,
      row.sdk_order_token_nonce,
      paymentSdkTokenAad(row.id, row.provider_order_id),
    ))
      .toBe(firstBody.checkout.token)
    expect(() => decryptGcm(
      MOBILE_TOKEN_KEY,
      row.sdk_order_token_ciphertext,
      row.sdk_order_token_nonce,
      paymentSdkTokenAad(randomUUID(), row.provider_order_id),
    )).toThrow()
    const guardedReplay = await unitOfWork.execute((tx) => paymentsRepository.markAttemptSdkDispatched(tx, {
      attemptId: row.id,
      providerOrderId: row.provider_order_id,
      providerState: "PENDING",
      checkoutExpiresAt: row.sdk_order_token_expires_at,
      tokenCiphertext: row.sdk_order_token_ciphertext,
      tokenNonce: row.sdk_order_token_nonce,
      tokenKeyVersion: row.sdk_order_token_key_version,
      tokenExpiresAt: row.sdk_order_token_expires_at,
      now: new Date(),
    }))
    expect(guardedReplay).toBeNull()

    const idempotency = await pool.query<{ response_body: string }>(
      "select response_body::text as response_body from idempotency_records where key = $1",
      [payKey],
    )
    const audit = await pool.query<{ metadata: string }>(
      "select metadata::text as metadata from audit_events where entity_type = 'payment_attempt' and entity_id = $1",
      [row.id],
    )
    expect(idempotency.rows[0]!.response_body).not.toContain(firstBody.checkout.token)
    expect(audit.rows[0]!.metadata).not.toContain(firstBody.checkout.token)

    const replay = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": payKey },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(replay.statusCode).toBe(200)
    expect(dataOf<{ checkout: { token: string } }>(replay).checkout.token).toBe(firstBody.checkout.token)
    expect(stubMobileOrderCalls).toEqual([row.merchant_order_id])

    const newKeyReplay = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `mobile-replay-${randomUUID()}` },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(newKeyReplay.statusCode).toBe(200)
    expect(dataOf<{ checkout: { token: string } }>(newKeyReplay).checkout.token).toBe(firstBody.checkout.token)
    expect(stubMobileOrderCalls).toEqual([row.merchant_order_id])

    const crossChannel = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `hosted-${randomUUID()}` },
      payload: { checkoutChannel: "hosted_redirect" },
    })
    expect(crossChannel.statusCode).toBe(400)
    await expect(pool.query("update payment_attempts set state = 'failed' where id = $1", [row.id])).rejects.toThrow()
    await pool.query(
      "update payment_attempts set state = 'failed', sdk_order_token_ciphertext = null, " +
        "sdk_order_token_nonce = null, sdk_order_token_key_version = null, sdk_order_token_expires_at = null where id = $1",
      [row.id],
    )
  })

  test("rejects disabled mobile checkout before attempt creation and rejects hosted fallback", async () => {
    const { userId, token } = await seedClientToken(`client-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await seedPublishedFund(`pay-disabled-${randomUUID().slice(0, 8)}`, financeAdminId)
    const created = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: { ...bearer(token), "idempotency-key": `create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "1000000" },
    })
    const orderId = dataOf<{ orderId: string }>(created).orderId
    const mobileCalls = stubMobileOrderCalls.length
    stubMobileEnabled = false
    try {
      const disabled = await app.inject({
        method: "POST",
        url: `/v1/client/orders/${orderId}/pay`,
        headers: { ...bearer(token), "idempotency-key": `mobile-${randomUUID()}` },
        payload: { checkoutChannel: "phonepe_mobile_sdk" },
      })
      expect(disabled.statusCode).toBe(409)
      expect(errorOf(disabled)).toBe("MOBILE_CHECKOUT_DISABLED")
      expect(stubMobileOrderCalls).toHaveLength(mobileCalls)
      const attemptsBeforeFallback = await pool.query<{ count: string }>(
        "select count(*)::text as count from payment_attempts where user_id = $1",
        [userId],
      )
      expect(attemptsBeforeFallback.rows[0]?.count).toBe("0")

      const hosted = await app.inject({
        method: "POST",
        url: `/v1/client/orders/${orderId}/pay`,
        headers: { ...bearer(token), "idempotency-key": `hosted-${randomUUID()}` },
        payload: { checkoutChannel: "hosted_redirect" },
      })
      expect(hosted.statusCode).toBe(400)
    } finally {
      await pool.query(
        "update payment_attempts set state = 'failed', provider_state = 'TEST_CLOSED' where user_id = $1 and state in ('created','provider_pending')",
        [userId],
      )
      stubMobileEnabled = true
    }
  })

  test("never repeats an ambiguous mobile SDK order and permits a fresh attempt only after expiry reconciliation", async () => {
    const { userId, token } = await seedClientToken(`client-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await seedPublishedFund(`pay-mobile-timeout-${randomUUID().slice(0, 8)}`, financeAdminId)
    const created = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: { ...bearer(token), "idempotency-key": `create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "1000000" },
    })
    const orderId = dataOf<{ orderId: string }>(created).orderId
    stubMobileOrderCalls = []
    stubMobileOrderError = new GatewayUnavailableError("ambiguous transport failure")

    const first = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `mobile-timeout-${randomUUID()}` },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(first.statusCode).toBe(503)
    expect(stubMobileOrderCalls).toHaveLength(1)

    const immediate = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `mobile-immediate-${randomUUID()}` },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(immediate.statusCode).toBe(409)
    expect(stubMobileOrderCalls).toHaveLength(1)

    stubOrderStatusError = new GatewayNotFoundError("not found")
    stubMobileOrderError = null
    const notFound = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `mobile-recover-${randomUUID()}` },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(notFound.statusCode).toBe(409)
    expect(stubMobileOrderCalls).toHaveLength(1)

    await pool.query(
      "update payment_attempts set checkout_expires_at = now() - interval '2 minutes' where user_id = $1",
      [userId],
    )
    const reconciliation = await runReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      paymentGateway: stubGateway,
      paymentsRepository,
      settlementRepository,
      refundRepository,
      logger: null,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect(reconciliation.attemptsResolved).toBe(1)
    stubOrderStatusError = null
    const recovered = await app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `mobile-fresh-${randomUUID()}` },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    expect(recovered.statusCode).toBe(200)
    expect(stubMobileOrderCalls).toHaveLength(2)
    expect(new Set(stubMobileOrderCalls).size).toBe(2)
    const attempts = await pool.query<{ count: string }>(
      "select count(*) as count from payment_attempts where user_id = $1",
      [userId],
    )
    expect(Number(attempts.rows[0]!.count)).toBe(2)
    await pool.query(
      "update payment_attempts set state = 'failed', sdk_order_token_ciphertext = null, " +
        "sdk_order_token_nonce = null, sdk_order_token_key_version = null, sdk_order_token_expires_at = null where user_id = $1",
      [userId],
    )
  })

  test("does not reconcile a fresh attempt while checkout dispatch is in flight", async () => {
    const { userId, token } = await seedClientToken(`client-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await seedPublishedFund(`pay-race-${randomUUID().slice(0, 8)}`, financeAdminId)
    const created = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: { ...bearer(token), "idempotency-key": `create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "1000000" },
    })
    const orderId = dataOf<{ orderId: string }>(created).orderId
    let releaseCheckout: () => void = () => undefined
    let reportCheckoutStarted: () => void = () => undefined
    const checkoutStarted = new Promise<void>((resolve) => { reportCheckoutStarted = resolve })
    stubCheckoutGate = new Promise<void>((resolve) => { releaseCheckout = resolve })
    stubCheckoutStarted = reportCheckoutStarted
    stubOrderStatusError = new GatewayNotFoundError("provider reference not found")
    stubOrderStatusCalls = 0

    const paymentResponse = app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `pay-${randomUUID()}` },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    await checkoutStarted
    const reconciliation = await runReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      paymentGateway: stubGateway,
      paymentsRepository,
      settlementRepository,
      refundRepository,
      logger: null,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    releaseCheckout()
    const response = await paymentResponse
    stubCheckoutGate = null
    stubCheckoutStarted = null
    stubOrderStatusError = null

    expect(reconciliation.attemptsChecked).toBe(0)
    expect(stubOrderStatusCalls).toBe(0)
    expect(response.statusCode).toBe(200)
    const attempts = await pool.query<{ state: string }>(
      "select state from payment_attempts where user_id = $1 order by attempt_number",
      [userId],
    )
    expect(attempts.rows).toEqual([{ state: "provider_pending" }])
  })

  test("does not return a checkout when the guarded dispatch transition loses", async () => {
    const { userId, token } = await seedClientToken(`client-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await seedPublishedFund(`pay-guard-${randomUUID().slice(0, 8)}`, financeAdminId)
    const created = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: { ...bearer(token), "idempotency-key": `create-${randomUUID()}` },
      payload: { fundId: fund.fundId, amountPaise: "1000000" },
    })
    const orderId = dataOf<{ orderId: string }>(created).orderId
    let releaseCheckout: () => void = () => undefined
    let reportCheckoutStarted: () => void = () => undefined
    const checkoutStarted = new Promise<void>((resolve) => { reportCheckoutStarted = resolve })
    stubCheckoutGate = new Promise<void>((resolve) => { releaseCheckout = resolve })
    stubCheckoutStarted = reportCheckoutStarted

    const paymentResponse = app.inject({
      method: "POST",
      url: `/v1/client/orders/${orderId}/pay`,
      headers: { ...bearer(token), "idempotency-key": `pay-${randomUUID()}` },
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
    })
    await checkoutStarted
    await pool.query("update payment_attempts set state = 'failed' where user_id = $1", [userId])
    releaseCheckout()
    const response = await paymentResponse
    stubCheckoutGate = null
    stubCheckoutStarted = null

    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toBe("STATE_CONFLICT")
  })
})

describe("PhonePe callback processing", () => {
  test("a succeeded callback immediately accepts and allocates exactly once", async () => {
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
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
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
    expect(order.rows[0]!.state).toBe("accepted")

    const acknowledgements = await pool.query<{ state: string }>(
      "select state from fund_receipt_acknowledgements where order_id = $1",
      [orderId],
    )
    expect(acknowledgements.rows).toEqual([{ state: "pending" }])
    expect((await pool.query<{ count: string }>(
      "select count(*) from investment_allocations where order_id = $1 and actor_type = 'system' and allocated_by_user_id is null",
      [orderId],
    )).rows[0]!.count).toBe("1")

    const paymentId = (await pool.query<{ id: string }>("select id from payments where order_id = $1", [orderId])).rows[0]!.id
    const paymentDetail = await app.inject({
      method: "GET",
      url: `/v1/client/payments/${paymentId}`,
      headers: bearer(token),
    })
    expect(paymentDetail.statusCode).toBe(200)
    const projectedPayment = dataOf<{ payment: { status: string; confirmedAt: string | null } }>(paymentDetail).payment
    expect(projectedPayment.status).toBe("confirmed")
    expect(typeof projectedPayment.confirmedAt).toBe("string")

    const portfolio = await app.inject({ method: "GET", url: "/v1/client/portfolio", headers: bearer(token) })
    expect(portfolio.statusCode).toBe(200)
    expect(dataOf<{ totalInvestmentPaise: string; currentValuePaise: string }>(portfolio))
      .toMatchObject({ totalInvestmentPaise: "1000000", currentValuePaise: "1000000" })
    expect((await pool.query<{ count: string }>(
      "select count(*) from client_value_entries where order_id = $1 and entry_type = 'contribution' and actor_type = 'system'",
      [orderId],
    )).rows[0]!.count).toBe("1")

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/provider-events/phonepe/payment",
      headers: { authorization: CALLBACK_AUTH, "content-type": "application/json" },
      payload: callbackFor(merchantOrderId, "checkout.order.completed", "COMPLETED"),
    })
    expect(duplicate.statusCode).toBe(200)
    const resultsAfterDuplicate = await pool.query<{ acknowledgements: string; allocations: string; contributions: string }>(
      "select " +
        "(select count(*) from fund_receipt_acknowledgements where order_id = $1)::text acknowledgements, " +
        "(select count(*) from investment_allocations where order_id = $1)::text allocations, " +
        "(select count(*) from client_value_entries where order_id = $1 and entry_type = 'contribution')::text contributions",
      [orderId],
    )
    expect(resultsAfterDuplicate.rows[0]).toEqual({ acknowledgements: "1", allocations: "1", contributions: "1" })
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
      payload: { checkoutChannel: "phonepe_mobile_sdk" },
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

const settleOrder = async (
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
    payload: { checkoutChannel: "phonepe_mobile_sdk" },
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

describe("admin fund acknowledgement", () => {
  test("acknowledges already allocated funds and notifies the client", async () => {
    const { orderId, userId, fundId } = await settleOrder("pay-ack")

    const acknowledgement = await pool.query<{ id: string; version: string }>(
      "select id, version from fund_receipt_acknowledgements where order_id = $1",
      [orderId],
    )

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/fund-receipts/${orderId}/acknowledge`,
      headers: adminHeaders(financeSession, { "idempotency-key": `acknowledge-${randomUUID()}` }),
      payload: { expectedVersion: Number(acknowledgement.rows[0]!.version) },
    })
    expect(response.statusCode).toBe(200)
    expect(dataOf<{ state: string }>(response).state).toBe("acknowledged")

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

    const notification = await pool.query<{ kind: string; title: string; body: string }>(
      "select kind, title, body from notifications where user_id = $1 and payload ->> 'orderId' = $2",
      [userId, orderId],
    )
    expect(notification.rows).toEqual([{
      kind: "fund_receipt_acknowledged",
      title: "Funds acknowledged",
      body: "Your funds have been acknowledged by BeOnEdge LLP and are ready for investment. Please stay updated through our app.",
    }])

    const aumRows = await pool.query<{ count: string }>(
      "select count(*) as count from fund_aum_snapshots where fund_id = $1",
      [fundId],
    )
    expect(Number(aumRows.rows[0]!.count)).toBe(0)
  })

  test("a stale version conflicts and writes nothing", async () => {
    const { orderId } = await settleOrder("pay-stale")
    const allocationsBefore = await pool.query<{ count: string }>(
      "select count(*) as count from investment_allocations where order_id = $1",
      [orderId],
    )

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/fund-receipts/${orderId}/acknowledge`,
      headers: adminHeaders(financeSession, { "idempotency-key": `acknowledge-stale-${randomUUID()}` }),
      payload: { expectedVersion: 999 },
    })
    expect(response.statusCode).toBe(409)

    const allocationsAfter = await pool.query<{ count: string }>(
      "select count(*) as count from investment_allocations where order_id = $1",
      [orderId],
    )
    expect(allocationsAfter.rows[0]!.count).toBe(allocationsBefore.rows[0]!.count)
  })

  test("a replayed acknowledgement returns the same result without duplicate writes", async () => {
    const { orderId } = await settleOrder("pay-replay")
    const review = await pool.query<{ version: string }>(
      "select version from fund_receipt_acknowledgements where order_id = $1",
      [orderId],
    )
    const key = `acknowledge-replay-${randomUUID()}`
    const payload = { expectedVersion: Number(review.rows[0]!.version) }

    const first = await app.inject({
      method: "POST",
      url: `/v1/admin/fund-receipts/${orderId}/acknowledge`,
      headers: adminHeaders(financeSession, { "idempotency-key": key }),
      payload,
    })
    expect(first.statusCode).toBe(200)

    const replay = await app.inject({
      method: "POST",
      url: `/v1/admin/fund-receipts/${orderId}/acknowledge`,
      headers: adminHeaders(financeSession, { "idempotency-key": key }),
      payload,
    })
    expect(replay.statusCode).toBe(200)

    const conflictingReplay = await app.inject({
      method: "POST",
      url: `/v1/admin/fund-receipts/${orderId}/acknowledge`,
      headers: adminHeaders(financeSession, { "idempotency-key": `acknowledge-again-${randomUUID()}` }),
      payload,
    })
    expect(conflictingReplay.statusCode).toBe(409)

    const allocations = await pool.query<{ count: string }>(
      "select count(*) as count from investment_allocations where order_id = $1",
      [orderId],
    )
    expect(Number(allocations.rows[0]!.count)).toBe(1)
    expect((await pool.query<{ count: string }>(
      "select count(*) from notifications where payload ->> 'orderId' = $1 and kind = 'fund_receipt_acknowledged'",
      [orderId],
    )).rows[0]!.count).toBe("1")
  })

  test("requires funds.receipts.write", async () => {
    const { orderId } = await settleOrder("pay-rbac")
    const review = await pool.query<{ version: string }>(
      "select version from fund_receipt_acknowledgements where order_id = $1",
      [orderId],
    )

    const denied = await app.inject({
      method: "POST",
      url: `/v1/admin/fund-receipts/${orderId}/acknowledge`,
      headers: adminHeaders(supportSession, { "idempotency-key": `acknowledge-denied-${randomUUID()}` }),
      payload: { expectedVersion: Number(review.rows[0]!.version) },
    })
    expect(denied.statusCode).toBe(403)
    expect(errorOf(denied)).toBe("AUTHORIZATION_DENIED")
  })
})

describe("admin refund operations", () => {
  test("requeues the failed refund, payment, and order exactly once", async () => {
    const { orderId } = await settleOrder("refund-retry")
    const payment = await pool.query<{ id: string }>(
      "select id from payments where order_id = $1",
      [orderId],
    )
    const refund = await pool.query<{ id: string }>(
      "insert into refund_operations " +
        "(payment_id, order_id, merchant_refund_id, amount_paise, state, failure_code, " +
        "created_by_user_id, request_id) values ($1, $2, $3, 1000000, 'failed', " +
        "'PROVIDER_UNAVAILABLE', $4, $5) returning id",
      [payment.rows[0]!.id, orderId, `refund_${randomUUID()}`, financeAdminId, randomUUID()],
    )
    await pool.query("update payments set state = 'refund_failed' where id = $1", [payment.rows[0]!.id])
    await pool.query(
      "update investment_orders set state = 'refund_failed', failure_code = 'PROVIDER_UNAVAILABLE' where id = $1",
      [orderId],
    )
    const key = `refund-retry-${randomUUID()}`

    const first = await app.inject({
      method: "POST",
      url: `/v1/admin/refunds/${refund.rows[0]!.id}/retry`,
      headers: adminHeaders(financeSession, { "idempotency-key": key }),
      payload: {},
    })
    expect(first.statusCode, first.body).toBe(200)
    expect(dataOf<{ state: string }>(first).state).toBe("pending")

    const replay = await app.inject({
      method: "POST",
      url: `/v1/admin/refunds/${refund.rows[0]!.id}/retry`,
      headers: adminHeaders(financeSession, { "idempotency-key": key }),
      payload: {},
    })
    expect(replay.statusCode, replay.body).toBe(200)

    const states = await pool.query<{
      refund_state: string
      payment_state: string
      order_state: string
      failure_code: string | null
      audit_count: string
    }>(
      "select refund.state as refund_state, payment.state as payment_state, investment_order.state as order_state, " +
        "investment_order.failure_code, count(audit.id)::text as audit_count " +
        "from refund_operations refund " +
        "join payments payment on payment.id = refund.payment_id " +
        "join investment_orders investment_order on investment_order.id = refund.order_id " +
        "left join audit_events audit on audit.entity_type = 'refund_operation' " +
        "and audit.entity_id = refund.id and audit.command = 'refund.retry' " +
        "where refund.id = $1 " +
        "group by refund.state, payment.state, investment_order.state, investment_order.failure_code",
      [refund.rows[0]!.id],
    )
    expect(states.rows[0]).toEqual({
      refund_state: "pending",
      payment_state: "refund_pending",
      order_state: "refund_pending",
      failure_code: null,
      audit_count: "1",
    })
  })

  test("rolls back the refund requeue when its payment is not retryable", async () => {
    const { orderId } = await settleOrder("refund-retry-conflict")
    const payment = await pool.query<{ id: string }>(
      "select id from payments where order_id = $1",
      [orderId],
    )
    const refund = await pool.query<{ id: string }>(
      "insert into refund_operations " +
        "(payment_id, order_id, merchant_refund_id, amount_paise, state, failure_code, " +
        "created_by_user_id, request_id) values ($1, $2, $3, 1000000, 'failed', " +
        "'PROVIDER_UNAVAILABLE', $4, $5) returning id",
      [payment.rows[0]!.id, orderId, `refund_${randomUUID()}`, financeAdminId, randomUUID()],
    )

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/refunds/${refund.rows[0]!.id}/retry`,
      headers: adminHeaders(financeSession, { "idempotency-key": `refund-retry-conflict-${randomUUID()}` }),
      payload: {},
    })
    expect(response.statusCode, response.body).toBe(409)

    const states = await pool.query<{ refund_state: string; payment_state: string; order_state: string }>(
      "select refund.state as refund_state, payment.state as payment_state, investment_order.state as order_state " +
        "from refund_operations refund " +
        "join payments payment on payment.id = refund.payment_id " +
        "join investment_orders investment_order on investment_order.id = refund.order_id " +
        "where refund.id = $1",
      [refund.rows[0]!.id],
    )
    expect(states.rows[0]).toEqual({
      refund_state: "failed",
      payment_state: "succeeded",
      order_state: "accepted",
    })
  })

  test("preserves a persisted provider refund identity across worker retries", async () => {
    const cases = [
      { suffix: "same", existingId: "provider_refund_same", returnedId: "provider_refund_same", expectedState: "provider_pending" },
      { suffix: "null", existingId: "provider_refund_null", returnedId: null, expectedState: "provider_pending" },
      { suffix: "mismatch", existingId: "provider_refund_original", returnedId: "provider_refund_different", expectedState: "failed" },
    ] as const
    const refundIds: string[] = []

    for (const scenario of cases) {
      const { orderId } = await settleOrder(`refund-identity-${scenario.suffix}`)
      const payment = await pool.query<{ id: string }>("select id from payments where order_id = $1", [orderId])
      const merchantRefundId = `refund_${randomUUID()}`
      const refund = await pool.query<{ id: string }>(
        "insert into refund_operations " +
          "(payment_id, order_id, merchant_refund_id, provider_refund_id, amount_paise, state, " +
          "created_by_user_id, request_id) values ($1, $2, $3, $4, 1000000, 'pending', $5, $6) returning id",
        [payment.rows[0]!.id, orderId, merchantRefundId, scenario.existingId, financeAdminId, randomUUID()],
      )
      await pool.query("update payments set state = 'refund_pending' where id = $1", [payment.rows[0]!.id])
      await pool.query("update investment_orders set state = 'refund_pending' where id = $1", [orderId])
      stubRefundInitiationIds.set(merchantRefundId, scenario.returnedId)
      refundIds.push(refund.rows[0]!.id)
    }

    const result = await runReconciliationPass({
      unitOfWork,
      clock: () => new Date(),
      paymentGateway: stubGateway,
      paymentsRepository,
      settlementRepository,
      refundRepository,
      logger: null,
      config: { claimLimit: 25, notFoundGraceMs: 60_000 },
    })
    expect(result.refundsChecked).toBeGreaterThanOrEqual(3)

    const states = await pool.query<{
      id: string
      provider_refund_id: string | null
      refund_state: string
      payment_state: string
      order_state: string
    }>(
      "select refund.id, refund.provider_refund_id, refund.state as refund_state, " +
        "payment.state as payment_state, investment_order.state as order_state " +
        "from refund_operations refund " +
        "join payments payment on payment.id = refund.payment_id " +
        "join investment_orders investment_order on investment_order.id = refund.order_id " +
        "where refund.id = any($1::uuid[]) order by refund.created_at",
      [refundIds],
    )
    expect(states.rows).toEqual([
      expect.objectContaining({
        provider_refund_id: "provider_refund_same",
        refund_state: "provider_pending",
        payment_state: "refund_pending",
        order_state: "refund_pending",
      }),
      expect.objectContaining({
        provider_refund_id: "provider_refund_null",
        refund_state: "provider_pending",
        payment_state: "refund_pending",
        order_state: "refund_pending",
      }),
      expect.objectContaining({
        provider_refund_id: "provider_refund_original",
        refund_state: "failed",
        payment_state: "refund_failed",
        order_state: "refund_failed",
      }),
    ])

    stubRefundInitiationIds.clear()
    await pool.query("update refund_operations set state = 'failed' where id = any($1::uuid[])", [refundIds])
  })
})

describe("removed investment decision endpoints", () => {
  test("does not expose accept or reject actions", async () => {
    const { orderId } = await settleOrder("pay-no-decisions")

    for (const action of ["accept", "reject"]) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/investment-reviews/${orderId}/${action}`,
        headers: adminHeaders(financeSession, { "idempotency-key": `${action}-${randomUUID()}` }),
        payload: {},
      })
      expect(response.statusCode).toBe(404)
    }
  })
})
