import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import { createSipEarlyExitGuard } from "../../src/domain/email/earlyExitGuard.js"
import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientMaturityOfferRepository } from "../../src/repositories/clientMaturityOfferRepository.js"
import { createClientMaturityScheduleRepository } from "../../src/repositories/clientMaturityScheduleRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createMaturityRepository } from "../../src/repositories/maturityRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createSipEarlyExitRepository } from "../../src/repositories/earlyExitRepository.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerAdminMaturityRoutes } from "../../src/routes/adminMaturityRoutes.js"
import { registerAdminMaturityScheduleRoutes } from "../../src/routes/adminMaturityScheduleRoutes.js"
import { registerAdminSipScheduleRoutes } from "../../src/routes/adminSipScheduleRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { registerSipEarlyExitSurface } from "../../src/runtime/earlyExitComposition.js"
import { ADMIN_ORIGIN, adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack, type Row } from "./passwordMailSupport.js"

interface Envelope<T> {
  readonly data: T
  readonly meta: { readonly idempotencyReplay?: boolean }
  readonly error: { readonly code: string; readonly message: string }
}

interface Payout {
  readonly id: string
  readonly state: string
  readonly version: string
  readonly amountPaise: string
  readonly growthPortionPaise: string
  readonly principalPortionPaise: string
}

interface EarlyExit {
  readonly earlyExitId: string
  readonly scheduleId: string
  readonly entryId: string
  readonly amountPaise: string
  readonly principalBeforePaise: string
  readonly valueBeforePaise: string
  readonly effectiveDate: string
  readonly cancelledMaturityScheduleId: string | null
  readonly cancelledMaturityDate: string | null
  readonly payout: Payout
}

type Holding = Readonly<{ userId: string; fundId: string; email: string }>

const FUND_NAME = "Early Exit Fund"
const INVESTED = 100_000
const FUTURE_MATURITY = "2099-12-31"
const PAST_MATURITY = "2025-12-31"
const TODAY_IN_INDIA = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const INJECTED_FAILURES = [
  ["client_value_entries", "INSERT"],
  ["withdrawal_operations", "INSERT"],
  ["admin_sip_schedules", "UPDATE"],
  ["client_maturity_schedules", "UPDATE"],
  ["sip_early_exits", "INSERT"],
  ["audit_events", "INSERT"],
  ["notifications", "INSERT"],
  ["email_deliveries", "INSERT"],
] as const

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let support: AdminSession
let accessTokenService: AccessTokenService
let fundId: string
let fundVersionId: string

const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

const seedFund = async (): Promise<void> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`early-exit-${randomUUID().slice(0, 8)}`, finance.userId],
  )
  const disclosure = await stack.first(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fund.id, randomBytes(32), finance.userId],
  )
  const version = await stack.first(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id, created_at) " +
      "values ($1, 1, $2, 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $3, $4, $5, '2024-01-01') returning id",
    [fund.id, FUND_NAME, disclosure.id, randomBytes(32), finance.userId],
  )
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [version.id, fund.id])
  fundId = String(fund.id)
  fundVersionId = String(version.id)
}

const growBy = async (holding: Holding, growthPaise: string): Promise<void> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/client-growth/individual",
    headers: adminHeaders(finance, randomUUID()),
    payload: { userId: holding.userId, fundId: holding.fundId, growthPaise, effectiveDate: "2025-06-02", reasonCode: "valuation_update" },
  })
  expect(response.statusCode, response.body).toBe(201)
}

const addContribution = async (holding: Holding, invested: number): Promise<void> => {
  const order = await stack.first(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'lump_sum', 'accepted', $4, now()) returning id",
    [holding.userId, fundId, fundVersionId, invested],
  )
  const payment = await stack.first(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, $3, 'succeeded', now()) returning id",
    [order.id, holding.userId, invested],
  )
  const allocation = await stack.first(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, $5, $6) returning id",
    [order.id, holding.userId, fundId, invested, finance.userId, randomUUID()],
  )
  await stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', $4, $4, '2025-01-15', $5, $6, 'investment_accepted', 'admin', $7, $8)",
    [holding.userId, fundId, allocation.id, invested, order.id, payment.id, finance.userId, randomUUID()],
  )
}

const seedHolding = async (growthPaise: string | null = null, invested = INVESTED): Promise<Holding> => {
  const user = await stack.seedUser()
  const holding = { userId: user.id, fundId, email: user.email }
  if (invested === 0) return holding
  await addContribution(holding, invested)
  if (growthPaise !== null) await growBy(holding, growthPaise)
  return holding
}

const seedActiveSip = async (holding: Holding): Promise<string> =>
  String(
    (
      await stack.first(
        "insert into admin_sip_schedules (user_id, fund_id, monthly_amount_paise, start_month, month_count, created_by_user_id, updated_by_user_id, request_id) " +
          "values ($1, $2, 500000, '2025-01-01', 12, $3, $3, $4) returning id",
        [holding.userId, holding.fundId, finance.userId, randomUUID()],
      )
    ).id,
  )

const setMaturityDate = async (holding: Holding, maturityDate: string): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${holding.userId}/maturity-schedules`,
    headers: adminHeaders(finance, randomUUID()),
    payload: { fundId: holding.fundId, maturityDate },
  })
  expect(response.statusCode, response.body).toBe(201)
  return envelopeOf<{ schedule: { scheduleId: string } }>(response).data.schedule.scheduleId
}

const exitUrl = (holding: Holding, scheduleId: string): string =>
  `/v1/admin/clients/${holding.userId}/sip-schedules/${scheduleId}/early-exit`

const exitEarly = (
  holding: Holding,
  scheduleId: string,
  body: Readonly<{ expectedVersion: number; expectedValuePaise: string }>,
  key: string = randomUUID(),
  headers: Record<string, string> = adminHeaders(finance, key),
) => app.inject({ method: "POST", url: exitUrl(holding, scheduleId), headers, payload: body })

const readAs = (session: AdminSession, url: string) => app.inject({ method: "GET", url, headers: adminHeaders(session) })

const clientToken = async (userId: string): Promise<string> => {
  const session = await stack.first(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [userId],
  )
  return accessTokenService.sign({ sub: userId, sid: String(session.id) })
}

const clientEarlyExits = async (userId: string): Promise<readonly Row[]> => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/client/sip-early-exits",
    headers: { authorization: `Bearer ${await clientToken(userId)}` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return envelopeOf<{ items: Row[] }>(response).data.items
}

const sums = async (holding: Holding): Promise<Row> =>
  stack.first(
    "select coalesce(sum(principal_delta_paise), 0)::text as principal, coalesce(sum(value_delta_paise), 0)::text as value " +
      "from client_value_entries where user_id = $1 and fund_id = $2",
    [holding.userId, holding.fundId],
  )

const holdingState = async (holding: Holding): Promise<readonly unknown[]> => [
  await sums(holding),
  (await stack.pool.query("select id, state, version::text, closed_at from admin_sip_schedules where user_id = $1 order by id", [holding.userId])).rows,
  (await stack.pool.query("select id, state, version::text from client_maturity_schedules where user_id = $1 order by id", [holding.userId])).rows,
  await stack.count("withdrawal_operations", "user_id = $1", [holding.userId]),
  await stack.count("client_position_maturities", "user_id = $1", [holding.userId]),
  await stack.count("sip_early_exits", "user_id = $1", [holding.userId]),
  await stack.count("notifications", "user_id = $1", [holding.userId]),
  await stack.count("email_deliveries", "user_id = $1", [holding.userId]),
]

const failNextWrite = async (table: string, operation: string): Promise<() => Promise<void>> => {
  await stack.pool.query(
    "CREATE OR REPLACE FUNCTION reject_early_exit_step() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$",
  )
  await stack.pool.query(`CREATE TRIGGER reject_early_exit_step BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_early_exit_step()`)
  return async () => {
    await stack.pool.query(`DROP TRIGGER reject_early_exit_step ON ${table}`)
  }
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
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
        notificationRepository: createNotificationRepository(),
        maturityRepository: createMaturityRepository(),
        sipScheduleRepository: createAdminSipScheduleRepository(),
      }
      const config = { idempotencyTtlMs: 86_400_000, cursorKey: randomBytes(32), sesConfigurationSet: "boe-transactional" }
      registerAdminClientGrowthRoutes(instance, { ...shared, config })
      registerAdminMaturityRoutes(instance, { ...shared, config })
      registerAdminSipScheduleRoutes(instance, { ...shared, config })
      registerAdminMaturityScheduleRoutes(instance, {
        ...shared,
        maturityScheduleRepository: createClientMaturityScheduleRepository(),
        maturityOfferRepository: createClientMaturityOfferRepository(),
        config,
      })
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
  await seedFund()
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("SIP early exit", () => {
  test("returns the full current value once, split into principal and growth, empties the holding and closes the SIP and its maturity date", async () => {
    const holding = await seedHolding("20000")
    const sipId = await seedActiveSip(holding)
    const maturityId = await setMaturityDate(holding, FUTURE_MATURITY)

    const preview = await readAs(finance, exitUrl(holding, sipId))
    expect(preview.statusCode, preview.body).toBe(200)
    expect(envelopeOf<Row>(preview).data).toMatchObject({
      scheduleVersion: 1,
      currentValuePaise: "120000",
      principalPortionPaise: "100000",
      growthPortionPaise: "20000",
      maturity: { scheduleId: maturityId, maturityDate: FUTURE_MATURITY },
      refusal: null,
    })

    const response = await exitEarly(holding, sipId, { expectedVersion: 1, expectedValuePaise: "120000" })
    expect(response.statusCode, response.body).toBe(201)
    const earlyExit = envelopeOf<{ earlyExit: EarlyExit }>(response).data.earlyExit
    expect(earlyExit).toMatchObject({
      scheduleId: sipId,
      amountPaise: "120000",
      principalBeforePaise: "100000",
      valueBeforePaise: "120000",
      effectiveDate: TODAY_IN_INDIA,
      cancelledMaturityScheduleId: maturityId,
      cancelledMaturityDate: FUTURE_MATURITY,
      payout: { state: "pending", amountPaise: "120000", growthPortionPaise: "20000", principalPortionPaise: "100000" },
    })
    expect(await sums(holding)).toEqual({ principal: "0", value: "0" })
    expect(
      await stack.first(
        "select principal_delta_paise::text as principal, value_delta_paise::text as value, reason_code, to_char(effective_date, 'YYYY-MM-DD') as date " +
          "from client_value_entries where id = $1 and entry_type = 'withdrawal'",
        [earlyExit.entryId],
      ),
    ).toEqual({ principal: "-100000", value: "-120000", reason_code: "sip_early_exit", date: TODAY_IN_INDIA })
    expect(await stack.first("select maturity_id, ledger_entry_id from withdrawal_operations where id = $1", [earlyExit.payout.id])).toEqual({
      maturity_id: null,
      ledger_entry_id: earlyExit.entryId,
    })
    expect(await stack.first("select state from admin_sip_schedules where id = $1", [sipId])).toEqual({ state: "closed" })
    expect(await stack.first("select state from client_maturity_schedules where id = $1", [maturityId])).toEqual({ state: "cancelled" })
    expect(await stack.count("client_position_maturities", "user_id = $1", [holding.userId])).toBe(0)
    for (const command of ["admin_sip_schedule.early_exit", "admin_sip_schedule.closed", "client_maturity_schedule.cancelled"]) {
      expect(await stack.count("audit_events", "command = $1 and metadata->>'userId' = $2", [command, holding.userId]), command).toBe(1)
    }
    const notices = await stack.pool.query("select kind, title, payload from notifications where user_id = $1 and payload ? 'earlyExitId'", [holding.userId])
    expect(notices.rows).toHaveLength(1)
    expect(notices.rows[0]).toEqual({
      kind: "client_value_updated",
      title: "SIP closed early",
      payload: { fundId, scheduleId: sipId, earlyExitId: earlyExit.earlyExitId, deepLink: "/activity" },
    })

    const transport = stack.transport()
    const guard = createSipEarlyExitGuard({ sipEarlyExitRepository: createSipEarlyExitRepository(), userRepository: stack.userRepository })
    await stack.dispatch(transport, stack.clock, stack.crypto, [["sip_early_exit", guard]])
    const mail = transport.messages.filter((message) => message.to === holding.email)
    expect(mail).toHaveLength(1)
    expect(mail[0]?.subject).toBe("Your SIP was closed early")
    expect(mail[0]?.text).toContain(`Your SIP in ${FUND_NAME} was closed early`)
    expect(mail[0]?.text).toContain("₹1,200.00")
    expect(mail[0]?.text).toContain("The payout is awaited.")
    expect(mail[0]?.text).not.toMatch(/IFSC|UTR|bank|transfer to/iu)

    const maturityPayouts = await readAs(finance, `/v1/admin/clients/${holding.userId}/withdrawal-payouts?limit=100`)
    expect(envelopeOf<{ items: unknown[] }>(maturityPayouts).data.items).toEqual([])
    const listed = await readAs(finance, `/v1/admin/clients/${holding.userId}/sip-early-exits`)
    expect(envelopeOf<{ items: EarlyExit[] }>(listed).data.items).toEqual([earlyExit])
    expect(await clientEarlyExits(holding.userId)).toEqual([
      expect.objectContaining({ earlyExitId: earlyExit.earlyExitId, fundName: FUND_NAME, amountPaise: "120000", effectiveDate: TODAY_IN_INDIA }),
    ])

    const paid = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${holding.userId}/withdrawal-payouts/${earlyExit.payout.id}/status`,
      headers: adminHeaders(finance, randomUUID()),
      payload: { state: "paid", expectedVersion: 0, transferReference: "bank-transfer-1" },
    })
    expect(paid.statusCode, paid.body).toBe(200)
    const after = await readAs(finance, `/v1/admin/clients/${holding.userId}/sip-early-exits`)
    expect(envelopeOf<{ items: EarlyExit[] }>(after).data.items[0]?.payout.state).toBe("paid")

    const reopen = await app.inject({
      method: "PATCH",
      url: `/v1/admin/clients/${holding.userId}/sip-schedules/${sipId}`,
      headers: adminHeaders(finance, randomUUID()),
      payload: { expectedVersion: 2, state: "active" },
    })
    expect(reopen.statusCode, reopen.body).toBe(409)
    expect(await stack.first("select state from admin_sip_schedules where id = $1", [sipId])).toEqual({ state: "closed" })

    const loss = await seedHolding("-20000")
    const lossSip = await seedActiveSip(loss)
    const lossExit = await exitEarly(loss, lossSip, { expectedVersion: 1, expectedValuePaise: "80000" })
    expect(lossExit.statusCode, lossExit.body).toBe(201)
    expect(envelopeOf<{ earlyExit: EarlyExit }>(lossExit).data.earlyExit.payout).toMatchObject({
      amountPaise: "80000",
      growthPortionPaise: "0",
      principalPortionPaise: "80000",
    })
    expect(await sums(loss)).toEqual({ principal: "20000", value: "0" })
  })

  test("a retry with the same key returns the first outcome, and a concurrent second exit is refused", async () => {
    const holding = await seedHolding()
    const sipId = await seedActiveSip(holding)
    const key = randomUUID()
    const first = await exitEarly(holding, sipId, { expectedVersion: 1, expectedValuePaise: "100000" }, key)
    expect(first.statusCode, first.body).toBe(201)
    const replay = await exitEarly(holding, sipId, { expectedVersion: 1, expectedValuePaise: "100000" }, key)
    expect(replay.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    expect(envelopeOf(replay).data).toEqual(envelopeOf(first).data)
    expect(await stack.count("client_value_entries", "user_id = $1 and entry_type = 'withdrawal'", [holding.userId])).toBe(1)
    expect(await stack.count("withdrawal_operations", "user_id = $1", [holding.userId])).toBe(1)
    expect(await stack.count("sip_early_exits", "user_id = $1", [holding.userId])).toBe(1)
    expect(await stack.count("email_deliveries", "user_id = $1", [holding.userId])).toBe(1)

    const raced = await seedHolding()
    const racedSip = await seedActiveSip(raced)
    const responses = await Promise.all([
      exitEarly(raced, racedSip, { expectedVersion: 1, expectedValuePaise: "100000" }),
      exitEarly(raced, racedSip, { expectedVersion: 1, expectedValuePaise: "100000" }),
    ])
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409])
    expect(await sums(raced)).toEqual({ principal: "0", value: "0" })
    expect(await stack.count("client_value_entries", "user_id = $1 and entry_type = 'withdrawal'", [raced.userId])).toBe(1)
    expect(await stack.count("withdrawal_operations", "user_id = $1", [raced.userId])).toBe(1)
    expect(await stack.count("sip_early_exits", "user_id = $1", [raced.userId])).toBe(1)
  })

  test("a failure at any step leaves the schedule, the ledger, the payout and the maturity date unchanged", async () => {
    const holding = await seedHolding("20000")
    const sipId = await seedActiveSip(holding)
    await setMaturityDate(holding, FUTURE_MATURITY)
    const before = await holdingState(holding)
    const key = randomUUID()

    for (const [table, operation] of INJECTED_FAILURES) {
      const restore = await failNextWrite(table, operation)
      try {
        const response = await exitEarly(holding, sipId, { expectedVersion: 1, expectedValuePaise: "120000" }, key)
        expect(response.statusCode, `${table} ${response.body}`).toBe(500)
        expect(await holdingState(holding), table).toEqual(before)
      } finally {
        await restore()
      }
    }

    const retry = await exitEarly(holding, sipId, { expectedVersion: 1, expectedValuePaise: "120000" }, key)
    expect(retry.statusCode, retry.body).toBe(201)
    expect(await sums(holding)).toEqual({ principal: "0", value: "0" })
  })

  test("refuses a closed schedule, an empty holding, a maturity being settled or due, a principal below zero, a second exit and a changed value, writing nothing", async () => {
    const closed = await seedHolding()
    const closedSip = await seedActiveSip(closed)
    await stack.pool.query("update admin_sip_schedules set state = 'closed', closed_at = now(), version = 2 where id = $1", [closedSip])

    const empty = await seedHolding(null, 0)
    const emptySip = await seedActiveSip(empty)

    const marked = await seedHolding()
    const markedSip = await seedActiveSip(marked)
    const mark = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${marked.userId}/maturities`,
      headers: adminHeaders(finance, randomUUID()),
      payload: { fundId, maturedOn: TODAY_IN_INDIA, reasonCode: "position_matured" },
    })
    expect(mark.statusCode, mark.body).toBe(201)

    const chosen = await seedHolding()
    const chosenSip = await seedActiveSip(chosen)
    const chosenMaturity = await setMaturityDate(chosen, FUTURE_MATURITY)
    await stack.pool.query(
      "insert into client_maturity_offers (maturity_schedule_id, user_id, fund_id, sip_monthly_amount_paise, sip_start_month, sip_month_count, " +
        "chosen_option, chosen_at, created_by_user_id, request_id) values ($1, $2, $3, 300000, '2099-01-01', 12, 'return_all', now(), $4, $5)",
      [chosenMaturity, chosen.userId, fundId, finance.userId, randomUUID()],
    )

    const due = await seedHolding()
    const dueSip = await seedActiveSip(due)
    await setMaturityDate(due, PAST_MATURITY)

    const belowZero = await seedHolding()
    const belowZeroSip = await seedActiveSip(belowZero)
    await stack.pool.query(
      "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
        "reason_code, actor_type, created_by_user_id, request_id) " +
        "values ($1, $2, 'maturity_reinvestment', -150000, 0, '2025-01-16', 'correction', 'admin', $3, $4)",
      [belowZero.userId, fundId, finance.userId, randomUUID()],
    )

    const reopened = await seedHolding()
    const reopenedSip = await seedActiveSip(reopened)
    const firstExit = await exitEarly(reopened, reopenedSip, { expectedVersion: 1, expectedValuePaise: "100000" })
    expect(firstExit.statusCode, firstExit.body).toBe(201)
    await stack.pool.query("update admin_sip_schedules set state = 'active', closed_at = null, version = version + 1 where id = $1", [reopenedSip])
    await addContribution(reopened, INVESTED)

    const changed = await seedHolding()
    const changedSip = await seedActiveSip(changed)

    const cases = [
      { holding: closed, sipId: closedSip, version: 2, value: "100000", message: "already closed" },
      { holding: empty, sipId: emptySip, version: 1, value: "100000", message: "no value to return" },
      { holding: marked, sipId: markedSip, version: 1, value: "100000", message: "being settled" },
      { holding: chosen, sipId: chosenSip, version: 1, value: "100000", message: "being settled" },
      { holding: due, sipId: dueSip, version: 1, value: "100000", message: "maturity date has arrived" },
      { holding: belowZero, sipId: belowZeroSip, version: 1, value: "100000", message: "invested amount is below zero" },
      { holding: reopened, sipId: reopenedSip, version: 3, value: "100000", message: "closed early before" },
      { holding: changed, sipId: changedSip, version: 1, value: "99999", message: "value changed" },
      { holding: changed, sipId: changedSip, version: 2, value: "100000", message: "changed this SIP schedule" },
    ]
    for (const refused of cases) {
      const before = await holdingState(refused.holding)
      const response = await exitEarly(refused.holding, refused.sipId, { expectedVersion: refused.version, expectedValuePaise: refused.value })
      expect(response.statusCode, response.body).toBe(409)
      expect(envelopeOf(response).error.message).toContain(refused.message)
      expect(await holdingState(refused.holding)).toEqual(before)
    }
    for (const refused of cases.slice(0, 7)) {
      const preview = await readAs(finance, exitUrl(refused.holding, refused.sipId))
      expect(preview.statusCode, preview.body).toBe(200)
      expect(envelopeOf<{ refusal: unknown }>(preview).data.refusal).not.toBeNull()
    }
  })

  test("only position writers exit early, with CSRF and an idempotency key, and only on the client's own schedule", async () => {
    const holding = await seedHolding()
    const sipId = await seedActiveSip(holding)
    const other = await seedHolding()
    const before = await holdingState(holding)
    const body = { expectedVersion: 1, expectedValuePaise: "100000" }

    expect((await exitEarly(holding, sipId, body, randomUUID(), adminHeaders(support, randomUUID()))).statusCode).toBe(403)
    expect((await readAs(support, exitUrl(holding, sipId))).statusCode).toBe(403)
    expect((await readAs(support, `/v1/admin/clients/${holding.userId}/sip-early-exits`)).statusCode).toBe(403)
    const noCsrf = { origin: ADMIN_ORIGIN, cookie: finance.cookie, "idempotency-key": randomUUID() }
    expect((await exitEarly(holding, sipId, body, randomUUID(), noCsrf)).statusCode).toBe(403)
    expect((await exitEarly(holding, sipId, body, randomUUID(), adminHeaders(finance))).statusCode).toBe(400)
    expect((await exitEarly(other, sipId, body)).statusCode).toBe(404)
    expect((await readAs(finance, exitUrl(other, sipId))).statusCode).toBe(404)
    expect(await holdingState(holding)).toEqual(before)

    expect((await exitEarly(holding, sipId, body)).statusCode).toBe(201)
    expect(await clientEarlyExits(other.userId)).toEqual([])
    const unauthenticated = await app.inject({ method: "GET", url: "/v1/client/sip-early-exits" })
    expect(unauthenticated.statusCode).toBe(401)
  })
})
