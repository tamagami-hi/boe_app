import { createHmac, randomBytes, randomUUID } from "node:crypto"
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
import { createPool } from "../../src/db/pool.js"
import { generateSipInstallments } from "../../src/domain/client/generateSipInstallments.js"
import { settleDuePayments } from "../../src/domain/client/settlePayment.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createHoldingRepository } from "../../src/repositories/holdingRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createMandateRepository } from "../../src/repositories/mandateRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createPaymentRepository } from "../../src/repositories/paymentRepository.js"
import { createSipRepository } from "../../src/repositories/sipRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerClientSipRoutes } from "../../src/routes/clientSipRoutes.js"
import { registerMandateWebhookRoutes } from "../../src/routes/mandateWebhookRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const WEBHOOK_SECRET = "test-mandate-webhook-secret"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let uow: UnitOfWork
let accessTokenService: AccessTokenService
let token: string
let userId: string
let fundId: string

const sipRepository = createSipRepository()
const mandateRepository = createMandateRepository()
const orderRepository = createOrderRepository()
const userRepository = createUserRepository()
const paymentRepository = createPaymentRepository()
const holdingRepository = createHoldingRepository()
const notificationRepository = createNotificationRepository()
const outboxRepository = createOutboxRepository()
const auditRepository = createAuditRepository()
const clock = () => new Date()

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const bearer = (key?: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  ...(key === undefined ? {} : { "idempotency-key": key }),
})

const generateDeps = () => ({
  unitOfWork: uow,
  sipRepository,
  orderRepository,
  userRepository,
  paymentRepository,
  outboxRepository,
  auditRepository,
  clock,
  config: { limit: 50, paymentProvider: "manual", attemptTtlMs: 900_000 },
})
const settleDeps = () => ({
  unitOfWork: uow,
  outboxRepository,
  paymentRepository,
  orderRepository,
  holdingRepository,
  notificationRepository,
  auditRepository,
  clock,
  config: { paymentProvider: "manual" },
  settleConfig: { topic: "payment", workerId: "t", leaseMs: 60_000, claimLimit: 50, autoConfirm: true },
})

const createSipHttp = (amountPaise: number, key = randomUUID()) =>
  app.inject({
    method: "POST",
    url: "/v1/client/sips",
    headers: bearer(key),
    payload: { fundId, amountPaise, debitDay: 5, durationMonths: 3 },
  })

const postMandateWebhook = (payload: Record<string, unknown>, signature?: string) => {
  const raw = JSON.stringify(payload)
  return app.inject({
    method: "POST",
    url: "/v1/provider-events/mandate",
    headers: {
      "content-type": "application/json",
      "x-mandate-signature": signature ?? createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"),
    },
    payload: raw,
  })
}
const authorizeMandate = (mandateId: string) => postMandateWebhook({ mandateId, status: "authorized" })

let draftFundId: string
let ineligibleToken: string

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
  const all = await loadMigrationFiles(directory)
  await runMigrations(
    pool,
    all.filter((file) => file.version >= "009"),
  )
  await runSeed(pool)
  const database = createDatabase(pool)
  uow = createUnitOfWork(database)

  const keyPair = await generateKeyPair("ES256", { extractable: true })
  accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })

  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerClientSipRoutes(instance, {
        accessTokenService,
        database,
        unitOfWork: uow,
        clock,
        sipRepository,
        mandateRepository,
        orderRepository,
        userRepository,
        outboxRepository,
        auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
        config: { idempotencyTtlMs: 86_400_000, paymentProvider: "manual", mandateFrequency: "monthly" },
      })
      registerMandateWebhookRoutes(instance, {
        unitOfWork: uow,
        clock,
        mandateRepository,
        sipRepository,
        auditRepository,
        config: { webhookSecret: WEBHOOK_SECRET },
      })
    },
  })

  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ('sip@example.com','+14155551601','Sip User','active', now()) returning id",
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
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [userId],
  )
  token = await accessTokenService.sign({ sub: userId, sid: session.rows[0]!.id })

  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ('sip-fund','published', now(), $1) returning id",
    [userId],
  )
  fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1,1,'D','b',$2, now(), $3) returning id",
    [fundId, randomBytes(32), userId],
  )
  const nav = await pool.query<{ id: string }>(
    "insert into fund_nav_prices (fund_id, nav, as_of_date, revision, published_by_user_id) " +
      "values ($1, 20.00000000, current_date, 1, $2) returning id",
    [fundId, userId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, initial_nav_price_id, terms_sha256, created_by_user_id) " +
      "values ($1,1,'Sip Fund','equity','grow','high', 50000, 100000, $2, $3, $4, $5) returning id",
    [fundId, disclosure.rows[0]!.id, nav.rows[0]!.id, randomBytes(32), userId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, fundId])

  // A draft (unpublished) fund for guard tests.
  const draft = await pool.query<{ id: string }>(
    "insert into funds (slug, state, created_by_user_id) values ('sip-draft-fund','draft', $1) returning id",
    [userId],
  )
  draftFundId = draft.rows[0]!.id

  // An active user without approved KYC (ineligible to invest).
  const ineligible = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ('sip-ineligible@example.com','+14155551602','Ineligible','active', now()) returning id",
  )
  const ineligibleSession = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [ineligible.rows[0]!.id],
  )
  ineligibleToken = await accessTokenService.sign({ sub: ineligible.rows[0]!.id, sid: ineligibleSession.rows[0]!.id })
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("client SIP lifecycle (integration)", () => {
  test("create -> mandate -> authorize -> scheduler -> settle books an installment", async () => {
    const created = await createSipHttp(200_000) // ₹2,000/installment @ NAV 20 => 100 units
    expect(created.statusCode).toBe(201)
    const sip = dataOf<{ sipId: string; status: string }>(created)
    expect(sip.status).toBe("draft")

    const mandateResp = await app.inject({
      method: "POST",
      url: `/v1/client/sips/${sip.sipId}/mandate`,
      headers: bearer(randomUUID()),
    })
    expect(mandateResp.statusCode).toBe(202)
    const withMandate = dataOf<{ status: string; mandateId: string }>(mandateResp)
    expect(withMandate.status).toBe("pending_mandate")

    const authorized = await authorizeMandate(withMandate.mandateId)
    expect(authorized.statusCode).toBe(200)
    expect(dataOf<{ outcome: string }>(authorized).outcome).toBe("activated")

    const activeSip = await pool.query<{ state: string; next_due_date: string | null }>(
      "select state, next_due_date from sip_plans where id = $1",
      [sip.sipId],
    )
    expect(activeSip.rows[0]?.state).toBe("active")
    expect(activeSip.rows[0]?.next_due_date).not.toBeNull()

    // Scheduler generates the first installment order (payment_pending).
    const genSummary = await generateSipInstallments(generateDeps())
    expect(genSummary.due).toBe(1)
    expect(genSummary.generated).toBe(1)
    const installment = await pool.query<{ state: string; type: string }>(
      "select state, type from investment_orders where sip_plan_id = $1",
      [sip.sipId],
    )
    expect(installment.rows[0]).toEqual({ state: "payment_pending", type: "sip_installment" })

    // Payment worker (mock) settles + books it into the holding.
    const settleSummary = await settleDuePayments(settleDeps())
    expect(settleSummary.booked).toBe(1)
    const holding = await pool.query<{ total_units: string }>(
      "select total_units from holdings where user_id = $1 and fund_id = $2",
      [userId, fundId],
    )
    expect(holding.rows[0]?.total_units).toBe("100.00000000")

    // The plan's next due date advanced by a month (day clamped to debit_day 5).
    const advanced = await pool.query<{ next_due_date: string }>(
      "select next_due_date::text as next_due_date from sip_plans where id = $1",
      [sip.sipId],
    )
    expect(advanced.rows[0]?.next_due_date).toMatch(/-05$/u)
  })

  test("a second scheduler pass does not double-charge (next due date is in the future)", async () => {
    const summary = await generateSipInstallments(generateDeps())
    expect(summary.due).toBe(0)
    expect(summary.generated).toBe(0)
  })

  test("SIP below the fund minimum is VALIDATION_FAILED", async () => {
    const response = await createSipHttp(10_000) // below 50000 minimum
    expect(response.statusCode).toBe(400)
    expect(errorOf(response)).toBe("VALIDATION_FAILED")
  })

  test("pause then resume then cancel an active SIP", async () => {
    const created = await createSipHttp(200_000)
    const sipId = dataOf<{ sipId: string }>(created).sipId
    const mandateResp = await app.inject({
      method: "POST",
      url: `/v1/client/sips/${sipId}/mandate`,
      headers: bearer(randomUUID()),
    })
    const mandateId = dataOf<{ mandateId: string }>(mandateResp).mandateId
    await authorizeMandate(mandateId)

    const paused = await app.inject({ method: "POST", url: `/v1/client/sips/${sipId}/pause`, headers: bearer(randomUUID()) })
    expect(paused.statusCode).toBe(200)
    expect(dataOf<{ status: string }>(paused).status).toBe("paused")

    const resumed = await app.inject({ method: "POST", url: `/v1/client/sips/${sipId}/resume`, headers: bearer(randomUUID()) })
    expect(dataOf<{ status: string }>(resumed).status).toBe("active")

    const cancelled = await app.inject({ method: "POST", url: `/v1/client/sips/${sipId}/cancel`, headers: bearer(randomUUID()) })
    expect(dataOf<{ status: string }>(cancelled).status).toBe("cancelled")

    // The unshared mandate is revoked when its only SIP is cancelled.
    const mandate = await pool.query<{ state: string }>("select state from mandates where id = $1", [mandateId])
    expect(mandate.rows[0]?.state).toBe("revoked")
  })

  test("requesting a mandate twice replays the first (idempotent)", async () => {
    const created = await createSipHttp(200_000)
    const sipId = dataOf<{ sipId: string }>(created).sipId
    const key = randomUUID()
    const first = await app.inject({ method: "POST", url: `/v1/client/sips/${sipId}/mandate`, headers: bearer(key) })
    const replay = await app.inject({ method: "POST", url: `/v1/client/sips/${sipId}/mandate`, headers: bearer(key) })
    expect(first.statusCode).toBe(202)
    expect(replay.statusCode).toBe(202)
    expect(dataOf<{ mandateId: string }>(replay).mandateId).toBe(dataOf<{ mandateId: string }>(first).mandateId)

    const mandateCount = await pool.query<{ c: number }>(
      "select count(*)::int as c from mandates where id in (select mandate_id from sip_plans where id = $1)",
      [sipId],
    )
    expect(mandateCount.rows[0]?.c).toBe(1)
  })

  test("create on a non-published fund is STATE_CONFLICT", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/sips",
      headers: bearer(randomUUID()),
      payload: { fundId: draftFundId, amountPaise: 200_000, debitDay: 5 },
    })
    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toBe("STATE_CONFLICT")
  })

  test("create for an ineligible client is STATE_CONFLICT", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/sips",
      headers: { authorization: `Bearer ${ineligibleToken}`, "idempotency-key": randomUUID() },
      payload: { fundId, amountPaise: 200_000, debitDay: 5 },
    })
    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toBe("STATE_CONFLICT")
  })

  test("SIP control guards: mandate-on-non-draft, pause/resume wrong state, cancel unknown", async () => {
    const created = await createSipHttp(200_000)
    const sipId = dataOf<{ sipId: string }>(created).sipId

    // pause a draft SIP -> conflict
    const pauseDraft = await app.inject({ method: "POST", url: `/v1/client/sips/${sipId}/pause`, headers: bearer(randomUUID()) })
    expect(pauseDraft.statusCode).toBe(409)

    // request mandate, then request again (non-draft) -> conflict
    await app.inject({ method: "POST", url: `/v1/client/sips/${sipId}/mandate`, headers: bearer(randomUUID()) })
    const secondMandate = await app.inject({
      method: "POST",
      url: `/v1/client/sips/${sipId}/mandate`,
      headers: bearer(randomUUID()),
    })
    expect(secondMandate.statusCode).toBe(409)
    expect(errorOf(secondMandate)).toBe("STATE_CONFLICT")

    // resume a non-paused SIP -> conflict
    const resumeConflict = await app.inject({ method: "POST", url: `/v1/client/sips/${sipId}/resume`, headers: bearer(randomUUID()) })
    expect(resumeConflict.statusCode).toBe(409)

    // cancel an unknown SIP -> 404
    const cancelUnknown = await app.inject({ method: "POST", url: `/v1/client/sips/${randomUUID()}/cancel`, headers: bearer(randomUUID()) })
    expect(cancelUnknown.statusCode).toBe(404)
  })

  test("mandate webhook: bad signature 401, unknown 404, failed revokes, authorized replay is idempotent", async () => {
    const created = await createSipHttp(200_000)
    const sipId = dataOf<{ sipId: string }>(created).sipId
    const mandateResp = await app.inject({
      method: "POST",
      url: `/v1/client/sips/${sipId}/mandate`,
      headers: bearer(randomUUID()),
    })
    const mandateId = dataOf<{ mandateId: string }>(mandateResp).mandateId

    const badSig = await postMandateWebhook({ mandateId, status: "authorized" }, "deadbeef")
    expect(badSig.statusCode).toBe(401)

    const unknown = await postMandateWebhook({ mandateId: randomUUID(), status: "authorized" })
    expect(unknown.statusCode).toBe(404)

    const failed = await postMandateWebhook({ mandateId, status: "failed" })
    expect(failed.statusCode).toBe(200)
    expect(dataOf<{ outcome: string }>(failed).outcome).toBe("failed")
    const revoked = await pool.query<{ state: string }>("select state from mandates where id = $1", [mandateId])
    expect(revoked.rows[0]?.state).toBe("revoked")

    // A failed replay is idempotent.
    const failedReplay = await postMandateWebhook({ mandateId, status: "failed" })
    expect(dataOf<{ outcome: string }>(failedReplay).outcome).toBe("already_failed")
  })

  test("authorized replay on an active mandate is a no-op", async () => {
    const created = await createSipHttp(200_000)
    const sipId = dataOf<{ sipId: string }>(created).sipId
    const mandateResp = await app.inject({
      method: "POST",
      url: `/v1/client/sips/${sipId}/mandate`,
      headers: bearer(randomUUID()),
    })
    const mandateId = dataOf<{ mandateId: string }>(mandateResp).mandateId
    expect(dataOf<{ outcome: string }>(await authorizeMandate(mandateId)).outcome).toBe("activated")
    expect(dataOf<{ outcome: string }>(await authorizeMandate(mandateId)).outcome).toBe("already_active")
  })

  test("scheduler skips a SIP whose fund is no longer published", async () => {
    const created = await createSipHttp(200_000)
    const sipId = dataOf<{ sipId: string }>(created).sipId
    const mandateResp = await app.inject({
      method: "POST",
      url: `/v1/client/sips/${sipId}/mandate`,
      headers: bearer(randomUUID()),
    })
    await authorizeMandate(dataOf<{ mandateId: string }>(mandateResp).mandateId)

    // Pause the fund so the installment cannot be created.
    await pool.query("update funds set state = 'paused', paused_at = now() where id = $1", [fundId])
    try {
      const summary = await generateSipInstallments(generateDeps())
      expect(summary.due).toBeGreaterThanOrEqual(1)
      expect(summary.skipped).toBeGreaterThanOrEqual(1)
      const installments = await pool.query<{ c: number }>(
        "select count(*)::int as c from investment_orders where sip_plan_id = $1",
        [sipId],
      )
      expect(installments.rows[0]?.c).toBe(0)
    } finally {
      await pool.query("update funds set state = 'published', paused_at = null where id = $1", [fundId])
    }
  })
})
