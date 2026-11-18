import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService } from "../../src/auth/accessToken.js"
import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthMailRepository } from "../../src/repositories/clientGrowthMailRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createMaturityRepository } from "../../src/repositories/maturityRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerAdminClientPositionRoutes } from "../../src/routes/adminClientPositionRoutes.js"
import { registerAdminMaturityRoutes } from "../../src/routes/adminMaturityRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { registerSipEarlyExitSurface } from "../../src/runtime/earlyExitComposition.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack, type Row } from "./passwordMailSupport.js"

interface Envelope<T> {
  readonly data: T
  readonly error: { readonly code: string; readonly message: string }
}

interface LedgerItem {
  readonly entryId: string
  readonly entryType: string
  readonly reversible: boolean
}

type Holding = Readonly<{ userId: string; fundId: string }>
type FinalEntry = Holding & Readonly<{ entryId: string }>

const INVESTED = 100_000
const TODAY_IN_INDIA = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let fundId: string
let fundVersionId: string

const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

const post = async (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, headers: adminHeaders(finance, randomUUID()), payload })

const seedFund = async (): Promise<void> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`final-entry-${randomUUID().slice(0, 8)}`, finance.userId],
  )
  const disclosure = await stack.first(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fund.id, randomBytes(32), finance.userId],
  )
  const version = await stack.first(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id, created_at) " +
      "values ($1, 1, 'Final Entry Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4, '2024-01-01') returning id",
    [fund.id, disclosure.id, randomBytes(32), finance.userId],
  )
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [version.id, fund.id])
  fundId = String(fund.id)
  fundVersionId = String(version.id)
}

const seedHolding = async (): Promise<Holding> => {
  const user = await stack.seedUser()
  const order = await stack.first(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'lump_sum', 'accepted', $4, now()) returning id",
    [user.id, fundId, fundVersionId, INVESTED],
  )
  const payment = await stack.first(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, $3, 'succeeded', now()) returning id",
    [order.id, user.id, INVESTED],
  )
  const allocation = await stack.first(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, $5, $6) returning id",
    [order.id, user.id, fundId, INVESTED, finance.userId, randomUUID()],
  )
  await stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', $4, $4, '2025-01-15', $5, $6, 'investment_accepted', 'admin', $7, $8)",
    [user.id, fundId, allocation.id, INVESTED, order.id, payment.id, finance.userId, randomUUID()],
  )
  return { userId: user.id, fundId }
}

const growBy = async (holding: Holding, growthPaise: string): Promise<string> => {
  const response = await post("/v1/admin/client-growth/individual", {
    userId: holding.userId,
    fundId: holding.fundId,
    growthPaise,
    effectiveDate: "2025-06-02",
    reasonCode: "monthly",
  })
  expect(response.statusCode, response.body).toBe(201)
  const entry = await stack.first(
    "select id from client_value_entries where user_id = $1 and entry_type = 'growth_adjustment' order by created_at desc limit 1",
    [holding.userId],
  )
  return String(entry.id)
}

const markMatured = async (holding: Holding): Promise<string> => {
  const response = await post(`/v1/admin/clients/${holding.userId}/maturities`, {
    fundId: holding.fundId,
    maturedOn: TODAY_IN_INDIA,
    reasonCode: "position_matured",
  })
  expect(response.statusCode, response.body).toBe(201)
  return envelopeOf<{ maturityId: string }>(response).data.maturityId
}

const settlementEntryOf = async (maturityId: string): Promise<string> =>
  String((await stack.first("select settlement_entry_id from client_position_maturities where id = $1", [maturityId])).settlement_entry_id)

const earlyExit = async (): Promise<FinalEntry> => {
  const holding = await seedHolding()
  const schedule = await stack.first(
    "insert into admin_sip_schedules (user_id, fund_id, monthly_amount_paise, start_month, month_count, created_by_user_id, updated_by_user_id, request_id) " +
      "values ($1, $2, 500000, '2025-01-01', 12, $3, $3, $4) returning id",
    [holding.userId, holding.fundId, finance.userId, randomUUID()],
  )
  const response = await post(`/v1/admin/clients/${holding.userId}/sip-schedules/${String(schedule.id)}/early-exit`, {
    expectedVersion: 1,
    expectedValuePaise: String(INVESTED),
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...holding, entryId: envelopeOf<{ earlyExit: { entryId: string } }>(response).data.earlyExit.entryId }
}

const maturityWithdrawal = async (): Promise<FinalEntry> => {
  const holding = await seedHolding()
  const maturityId = await markMatured(holding)
  const response = await post(`/v1/admin/clients/${holding.userId}/maturities/${maturityId}/withdrawal`, {
    fundId: holding.fundId,
    effectiveDate: TODAY_IN_INDIA,
    amountPaise: "30000",
    reasonCode: "maturity_withdrawal",
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...holding, entryId: await settlementEntryOf(maturityId) }
}

const maturityReinvestment = async (): Promise<FinalEntry> => {
  const holding = await seedHolding()
  await growBy(holding, "20000")
  const maturityId = await markMatured(holding)
  const response = await post(`/v1/admin/clients/${holding.userId}/maturities/${maturityId}/reinvestment`, {
    fundId: holding.fundId,
    effectiveDate: TODAY_IN_INDIA,
    reasonCode: "maturity_reinvestment",
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...holding, entryId: await settlementEntryOf(maturityId) }
}

const payoutWithdrawal = async (): Promise<FinalEntry> => {
  const holding = await seedHolding()
  const entry = await stack.first(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "reason_code, actor_type, created_by_user_id, request_id) values ($1, $2, 'withdrawal', -25000, -25000, $3, 'payout_only', 'admin', $4, $5) returning id",
    [holding.userId, holding.fundId, TODAY_IN_INDIA, finance.userId, randomUUID()],
  )
  await stack.pool.query(
    "insert into withdrawal_operations (user_id, fund_id, maturity_id, ledger_entry_id, amount_paise, growth_portion_paise, principal_portion_paise, " +
      "effective_date, reason_code, created_by_user_id, request_id) values ($1, $2, null, $3, 25000, 0, 25000, $4, 'payout_only', $5, $6)",
    [holding.userId, holding.fundId, entry.id, TODAY_IN_INDIA, finance.userId, randomUUID()],
  )
  return { ...holding, entryId: String(entry.id) }
}

const ledgerItem = async (holding: Holding, entryId: string): Promise<LedgerItem | undefined> => {
  const response = await app.inject({
    method: "GET",
    url: `/v1/admin/clients/${holding.userId}/ledger-entries`,
    headers: adminHeaders(finance),
  })
  expect(response.statusCode, response.body).toBe(200)
  return envelopeOf<{ items: LedgerItem[] }>(response).data.items.find((item) => item.entryId === entryId)
}

const reverse = async (holding: Holding, entryId: string) =>
  post(`/v1/admin/clients/${holding.userId}/ledger-entries/${entryId}/reversal`, { reasonCode: "admin_correction_reversal" })

const stateOf = async (holding: Holding): Promise<readonly unknown[]> => [
  (
    await stack.pool.query(
      "select id, entry_type, principal_delta_paise::text, value_delta_paise::text, reverses_entry_id from client_value_entries where user_id = $1 order by id",
      [holding.userId],
    )
  ).rows,
  (await stack.pool.query("select id, state, version::text from withdrawal_operations where user_id = $1 order by id", [holding.userId])).rows,
  (await stack.pool.query("select id, state, settlement from client_position_maturities where user_id = $1 order by id", [holding.userId])).rows,
  (await stack.pool.query("select id, state, version::text from admin_sip_schedules where user_id = $1 order by id", [holding.userId])).rows,
  await stack.count("notifications", "user_id = $1", [holding.userId]),
  await stack.count("audit_events", "metadata->>'userId' = $1", [holding.userId]),
  await stack.count("idempotency_records"),
]

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
        clock: stack.clock,
        auditRepository: stack.auditRepository,
        userRepository: stack.userRepository,
        idempotencyRepository: createIdempotencyRepository(),
        clientGrowthRepository: createClientGrowthRepository(),
        clientGrowthMailRepository: createClientGrowthMailRepository(),
        notificationRepository: createNotificationRepository(),
        maturityRepository: createMaturityRepository(),
        sipScheduleRepository: createAdminSipScheduleRepository(),
        outboxRepository: stack.outboxRepository,
        emailDeliveryRepository: stack.emailDeliveryRepository,
        crypto: stack.crypto,
      }
      const config = { idempotencyTtlMs: 86_400_000, cursorKey: randomBytes(32), sesConfigurationSet: "boe-transactional" }
      registerAdminClientGrowthRoutes(instance, { ...shared, config })
      registerAdminMaturityRoutes(instance, { ...shared, config })
      registerAdminClientPositionRoutes(instance, { ...shared, clientPositionRepository: createClientPositionRepository(), config })
      registerSipEarlyExitSurface(instance, { ...shared, accessTokenService, clientWeb: { originAllowlist: [] }, config })
    },
  })
  finance = await signInRoleAdmin(app, stack, "finance")
  await seedFund()
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("final ledger entries", () => {
  test.each([
    ["a SIP early exit", earlyExit],
    ["a maturity withdrawal", maturityWithdrawal],
    ["a maturity reinvestment", maturityReinvestment],
    ["a withdrawal payout", payoutWithdrawal],
  ] as const)("refuse the reversal of %s, are not offered as reversible, and nothing changes", async (_label, build) => {
    const final = await build()
    expect(await ledgerItem(final, final.entryId)).toMatchObject({ reversible: false })
    const before = await stateOf(final)

    const refused = await reverse(final, final.entryId)

    expect(refused.statusCode, refused.body).toBe(409)
    expect(envelopeOf<Row>(refused).error.code).toBe("STATE_CONFLICT")
    expect(envelopeOf<Row>(refused).error.message).toMatch(/final/u)
    expect(await stateOf(final)).toEqual(before)
  })

  test("an ordinary growth update stays reversible", async () => {
    const holding = await seedHolding()
    const growthEntryId = await growBy(holding, "20000")
    expect(await ledgerItem(holding, growthEntryId)).toMatchObject({ entryType: "growth_adjustment", reversible: true })

    const reversed = await reverse(holding, growthEntryId)

    expect(reversed.statusCode, reversed.body).toBe(201)
    expect(await stack.count("client_value_entries", "reverses_entry_id = $1", [growthEntryId])).toBe(1)
  })
})
