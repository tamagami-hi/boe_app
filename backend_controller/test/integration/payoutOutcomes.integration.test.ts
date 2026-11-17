import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { z } from "zod"

import { createAccessTokenService } from "../../src/auth/accessToken.js"
import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createMaturityRepository } from "../../src/repositories/maturityRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminMaturityRoutes } from "../../src/routes/adminMaturityRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { registerSipEarlyExitSurface } from "../../src/runtime/earlyExitComposition.js"
import { ADMIN_ORIGIN, adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

const RELEASED_UUID = z.string().uuid()
const RELEASED_PAISE = z.string().regex(/^(0|[1-9][0-9]*)$/u)
const RELEASED_DATE_TIME = z.iso.datetime({ offset: true })
const RELEASED_ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const releasedEnvelope = <T extends z.ZodType>(data: T) =>
  z.strictObject({
    ok: z.literal(true),
    data,
    error: z.null(),
    meta: z.strictObject({ requestId: RELEASED_UUID, timestamp: RELEASED_DATE_TIME, idempotencyReplay: z.boolean().optional() }),
  })
const RELEASED_PAYOUT_FIELDS = {
  id: RELEASED_UUID,
  userId: RELEASED_UUID,
  fundId: RELEASED_UUID,
  ledgerEntryId: RELEASED_UUID,
  state: z.enum(["pending", "paid", "failed"]),
  amountPaise: RELEASED_PAISE,
  growthPortionPaise: RELEASED_PAISE,
  principalPortionPaise: RELEASED_PAISE,
  effectiveDate: z.iso.date(),
  transferReference: z.string().nullable(),
  failureCode: z.string().nullable(),
  version: RELEASED_PAISE,
  createdAt: RELEASED_DATE_TIME,
}
const RELEASED_PAYOUT_LIST = releasedEnvelope(
  z.strictObject({ userId: RELEASED_UUID, items: z.array(z.strictObject({ ...RELEASED_PAYOUT_FIELDS, maturityId: RELEASED_UUID })) }),
)
const RELEASED_EARLY_EXIT_LIST = releasedEnvelope(
  z.strictObject({
    items: z.array(
      z.strictObject({
        earlyExitId: RELEASED_UUID,
        scheduleId: RELEASED_UUID,
        userId: RELEASED_UUID,
        fundId: RELEASED_UUID,
        fundName: z.string(),
        entryId: RELEASED_UUID,
        amountPaise: RELEASED_PAISE,
        principalBeforePaise: RELEASED_PAISE,
        valueBeforePaise: RELEASED_PAISE,
        effectiveDate: RELEASED_ISO_DATE,
        cancelledMaturityScheduleId: RELEASED_UUID.nullable(),
        cancelledMaturityDate: RELEASED_ISO_DATE.nullable(),
        createdAt: RELEASED_DATE_TIME,
        payout: z.strictObject(RELEASED_PAYOUT_FIELDS),
      }),
    ),
  }),
)

const PAID_AT = "2099-11-16T20:00:00.000Z"
const FAILED_AT = "2099-11-15T19:00:00.000Z"
const OTHER_PAID_AT = "2099-11-14T18:30:00.000Z"
const INVESTED = 100_000
const SETTLED_ON = "2025-06-02"

type Fund = Readonly<{ fundId: string; versionId: string }>
type Outcome = Readonly<{ payoutId: string; state: string; paidAt: string | null; failedAt: string | null }>

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let support: AdminSession
let fixedAt: Date | null = null
let client: string
let otherClient: string
let paidPayout: string
let failedEarlyExitPayout: string
let pendingPayout: string
let otherPayout: string

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data

const seedFund = async (): Promise<Fund> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`outcome-${randomUUID().slice(0, 8)}`, finance.userId],
  )
  const disclosure = await stack.first(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fund.id, randomBytes(32), finance.userId],
  )
  const version = await stack.first(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id, created_at) " +
      "values ($1, 1, 'Outcome Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4, '2024-01-01') returning id",
    [fund.id, disclosure.id, randomBytes(32), finance.userId],
  )
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [version.id, fund.id])
  return { fundId: String(fund.id), versionId: String(version.id) }
}

const addContribution = async (userId: string, fund: Fund): Promise<void> => {
  const order = await stack.first(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'lump_sum', 'accepted', $4, now()) returning id",
    [userId, fund.fundId, fund.versionId, INVESTED],
  )
  const payment = await stack.first(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, $3, 'succeeded', now()) returning id",
    [order.id, userId, INVESTED],
  )
  const allocation = await stack.first(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, $5, $6) returning id",
    [order.id, userId, fund.fundId, INVESTED, finance.userId, randomUUID()],
  )
  await stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', $4, $4, '2025-01-15', $5, $6, 'investment_accepted', 'admin', $7, $8)",
    [userId, fund.fundId, allocation.id, INVESTED, order.id, payment.id, finance.userId, randomUUID()],
  )
}

const maturityPayout = async (userId: string, fund: Fund): Promise<string> => {
  await addContribution(userId, fund)
  const marked = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/maturities`,
    headers: adminHeaders(finance, randomUUID()),
    payload: { fundId: fund.fundId, maturedOn: SETTLED_ON, reasonCode: "position_matured" },
  })
  expect(marked.statusCode, marked.body).toBe(201)
  const { maturityId } = dataOf<{ maturityId: string }>(marked)
  const withdrawn = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/maturities/${maturityId}/withdrawal`,
    headers: adminHeaders(finance, randomUUID()),
    payload: { fundId: fund.fundId, effectiveDate: SETTLED_ON, amountPaise: "30000", reasonCode: "maturity_withdrawal" },
  })
  expect(withdrawn.statusCode, withdrawn.body).toBe(201)
  return dataOf<{ payoutId: string }>(withdrawn).payoutId
}

const earlyExitPayout = async (userId: string, fund: Fund): Promise<string> => {
  await addContribution(userId, fund)
  const schedule = await stack.first(
    "insert into admin_sip_schedules (user_id, fund_id, monthly_amount_paise, start_month, month_count, created_by_user_id, updated_by_user_id, request_id) " +
      "values ($1, $2, 500000, '2025-01-01', 12, $3, $3, $4) returning id",
    [userId, fund.fundId, finance.userId, randomUUID()],
  )
  const exited = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/sip-schedules/${String(schedule.id)}/early-exit`,
    headers: adminHeaders(finance, randomUUID()),
    payload: { expectedVersion: 1, expectedValuePaise: String(INVESTED) },
  })
  expect(exited.statusCode, exited.body).toBe(201)
  return dataOf<{ earlyExit: { payout: { id: string } } }>(exited).earlyExit.payout.id
}

const recordOutcome = async (userId: string, payoutId: string, body: Readonly<Record<string, unknown>>, at: string): Promise<void> => {
  fixedAt = new Date(at)
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/withdrawal-payouts/${payoutId}/status`,
    headers: adminHeaders(finance, randomUUID()),
    payload: { expectedVersion: 0, ...body },
  })
  fixedAt = null
  expect(response.statusCode, response.body).toBe(200)
}

const outcomesOf = (session: AdminSession, userId: string, query = "") =>
  app.inject({ method: "GET", url: `/v1/admin/clients/${userId}/withdrawal-payout-outcomes${query}`, headers: adminHeaders(session) })

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  const accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      const shared = {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: () => fixedAt ?? new Date(),
        auditRepository: stack.auditRepository,
        userRepository: stack.userRepository,
        idempotencyRepository: createIdempotencyRepository(),
        clientGrowthRepository: createClientGrowthRepository(),
        notificationRepository: createNotificationRepository(),
        maturityRepository: createMaturityRepository(),
        sipScheduleRepository: createAdminSipScheduleRepository(),
      }
      const config = { idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" }
      registerAdminMaturityRoutes(instance, { ...shared, config })
      registerSipEarlyExitSurface(instance, {
        ...shared,
        outboxRepository: stack.outboxRepository,
        emailDeliveryRepository: stack.emailDeliveryRepository,
        crypto: stack.crypto,
        accessTokenService,
        clientWeb: { originAllowlist: [] },
        config,
      })
    },
  })
  finance = await signInRoleAdmin(app, stack, "finance")
  support = await signInRoleAdmin(app, stack, "support")

  const [maturityFund, exitFund, pendingFund] = [await seedFund(), await seedFund(), await seedFund()]
  client = (await stack.seedUser()).id
  otherClient = (await stack.seedUser()).id
  paidPayout = await maturityPayout(client, maturityFund)
  failedEarlyExitPayout = await earlyExitPayout(client, exitFund)
  pendingPayout = await maturityPayout(client, pendingFund)
  otherPayout = await maturityPayout(otherClient, maturityFund)
  await recordOutcome(client, paidPayout, { state: "paid" }, PAID_AT)
  await recordOutcome(client, failedEarlyExitPayout, { state: "failed", failureCode: "bank_rejected" }, FAILED_AT)
  await recordOutcome(otherClient, otherPayout, { state: "paid" }, OTHER_PAID_AT)
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("withdrawal payout outcome dates", () => {
  test("returns each payout's paid or failed time for that client only, newest first, bounded, and refuses a role without client access", async () => {
    const response = await outcomesOf(finance, client)
    expect(response.statusCode, response.body).toBe(200)
    expect(dataOf<{ userId: string; items: Outcome[] }>(response)).toEqual({
      userId: client,
      items: [
        { payoutId: pendingPayout, state: "pending", paidAt: null, failedAt: null },
        { payoutId: failedEarlyExitPayout, state: "failed", paidAt: null, failedAt: FAILED_AT },
        { payoutId: paidPayout, state: "paid", paidAt: PAID_AT, failedAt: null },
      ],
    })

    const other = await outcomesOf(finance, otherClient)
    expect(dataOf<{ items: Outcome[] }>(other).items).toEqual([
      { payoutId: otherPayout, state: "paid", paidAt: OTHER_PAID_AT, failedAt: null },
    ])

    const newest = await outcomesOf(finance, client, "?limit=1")
    expect(dataOf<{ items: Outcome[] }>(newest).items.map((item) => item.payoutId)).toEqual([pendingPayout])
    expect((await outcomesOf(finance, client, "?limit=101")).statusCode).toBe(400)

    expect((await outcomesOf(support, client)).statusCode).toBe(403)
    const anonymous = await app.inject({
      method: "GET",
      url: `/v1/admin/clients/${client}/withdrawal-payout-outcomes`,
      headers: { origin: ADMIN_ORIGIN },
    })
    expect(anonymous.statusCode).toBe(401)
  })

  test("the existing payout and early-exit lists still parse under the released admin app's frozen schemas", async () => {
    const payouts = await app.inject({
      method: "GET",
      url: `/v1/admin/clients/${client}/withdrawal-payouts?limit=100`,
      headers: adminHeaders(finance),
    })
    expect(payouts.statusCode, payouts.body).toBe(200)
    const parsedPayouts = RELEASED_PAYOUT_LIST.safeParse(payouts.json())
    expect(parsedPayouts.error).toBeUndefined()
    expect(parsedPayouts.data?.data.items.map((item) => [item.id, item.state])).toEqual([
      [pendingPayout, "pending"],
      [paidPayout, "paid"],
    ])

    const exits = await app.inject({ method: "GET", url: `/v1/admin/clients/${client}/sip-early-exits`, headers: adminHeaders(finance) })
    expect(exits.statusCode, exits.body).toBe(200)
    const parsedExits = RELEASED_EARLY_EXIT_LIST.safeParse(exits.json())
    expect(parsedExits.error).toBeUndefined()
    expect(parsedExits.data?.data.items.map((item) => [item.payout.id, item.payout.state])).toEqual([[failedEarlyExitPayout, "failed"]])
  })
})
