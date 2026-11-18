import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import { createMaturityOptionsGuard } from "../../src/domain/email/maturityOptionsGuard.js"
import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientMaturityOfferRepository } from "../../src/repositories/clientMaturityOfferRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createMaturityRepository } from "../../src/repositories/maturityRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { registerMaturitySurface } from "../../src/runtime/maturityComposition.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { GROWTH_CONFIG, growthMailDeps } from "./growthMailSupport.js"
import { PasswordMailStack, type Row } from "./passwordMailSupport.js"

interface Envelope<T> {
  readonly data: T
  readonly meta: { readonly idempotencyReplay?: boolean }
  readonly error: { readonly code: string; readonly message: string; readonly fields?: Record<string, readonly string[]> }
}

interface Offer {
  readonly offerId: string
  readonly version: number
  readonly state?: string
  readonly chosenOption: string | null
}

interface Schedule {
  readonly scheduleId: string
  readonly state: string
  readonly resolution: string | null
  readonly followUpSipScheduleId: string | null
  readonly version: number
  readonly offer: Offer | null
}

interface Resolution {
  readonly schedule: Schedule
  readonly settlementEntryId: string | null
  readonly payoutId: string | null
  readonly nextScheduleId: string | null
}

type Holding = Readonly<{ userId: string; fundId: string; email: string }>

const FUND_NAME = "Choices Growth Fund"
const MATURED_ON = "2025-12-31"
const NEXT_MATURITY = "2026-12-31"
const INVESTED = 100_000
const MONEY_TABLES = [
  "client_value_entries",
  "client_position_maturities",
  "withdrawal_operations",
  "investment_orders",
  "payments",
  "admin_sip_schedule_months",
] as const

const INDIA_MONTH = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7)
const nextMonthOf = (month: string): string => {
  const [year, number] = month.split("-").map(Number) as [number, number]
  return number === 12 ? `${String(year + 1)}-01` : `${String(year)}-${String(number + 1).padStart(2, "0")}`
}
const followUp = { monthlyAmountPaise: "300000", startMonth: nextMonthOf(INDIA_MONTH), monthCount: 24 }
const extension = { months: 12, nextMaturityDate: NEXT_MATURITY }

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let accessTokenService: AccessTokenService
let fundId: string
let fundVersionId: string

const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

const moneyCounts = async (): Promise<number[]> => Promise.all(MONEY_TABLES.map((table) => stack.count(table)))

const sipRows = async (userId: string): Promise<Row[]> =>
  (await stack.pool.query<Row>("select to_jsonb(s) as row from admin_sip_schedules s where user_id = $1 order by id", [userId])).rows

const seedFund = async (): Promise<void> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`choices-${randomUUID().slice(0, 8)}`, finance.userId],
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
  return { userId: user.id, fundId, email: user.email }
}

const seedActiveSip = async (holding: Holding, monthCount = 12): Promise<string> =>
  String(
    (
      await stack.first(
        "insert into admin_sip_schedules (user_id, fund_id, monthly_amount_paise, start_month, month_count, created_by_user_id, updated_by_user_id, request_id) " +
          "values ($1, $2, 500000, '2025-01-01', $3, $4, $4, $5) returning id",
        [holding.userId, holding.fundId, monthCount, finance.userId, randomUUID()],
      )
    ).id,
  )

const clientToken = async (userId: string): Promise<string> => {
  const session = await stack.first(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [userId],
  )
  return accessTokenService.sign({ sub: userId, sid: String(session.id) })
}

const adminPost = (url: string, payload: Record<string, unknown>, key: string = randomUUID()) =>
  app.inject({ method: "POST", url, headers: adminHeaders(finance, key), payload })

const scheduleUrl = (holding: Holding, schedule: Schedule): string =>
  `/v1/admin/clients/${holding.userId}/maturity-schedules/${schedule.scheduleId}`

const scheduled = async (holding: Holding, maturityDate = MATURED_ON): Promise<Schedule> => {
  const response = await adminPost(`/v1/admin/clients/${holding.userId}/maturity-schedules`, { fundId: holding.fundId, maturityDate })
  expect(response.statusCode, response.body).toBe(201)
  return envelopeOf<{ schedule: Schedule }>(response).data.schedule
}

const send = (holding: Holding, schedule: Schedule, withExtension = true, offerVersion: number | null = null) =>
  adminPost(`${scheduleUrl(holding, schedule)}/offers`, {
    expectedVersion: schedule.version,
    offerVersion,
    sip: followUp,
    extension: withExtension ? extension : null,
  })

const sent = async (holding: Holding, schedule: Schedule, withExtension = true, offerVersion: number | null = null): Promise<Offer> => {
  const response = await send(holding, schedule, withExtension, offerVersion)
  expect(response.statusCode, response.body).toBe(201)
  const offer = envelopeOf<{ schedule: Schedule }>(response).data.schedule.offer
  if (offer === null) throw new Error("no open offer after sending")
  return offer
}

const choose = (token: string, offerId: string, option: string, expectedVersion: number, key: string = randomUUID()) =>
  app.inject({
    method: "POST",
    url: `/v1/client/maturity-options/${offerId}/choice`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
    payload: { option, expectedVersion },
  })

const readOffer = (token: string, offerId: string) =>
  app.inject({ method: "GET", url: `/v1/client/maturity-options/${offerId}`, headers: { authorization: `Bearer ${token}` } })

const confirm = (holding: Holding, schedule: Schedule, offer: Offer, body: Record<string, unknown>, key: string = randomUUID()) =>
  adminPost(
    `${scheduleUrl(holding, schedule)}/offers/${offer.offerId}/confirm`,
    { expectedVersion: schedule.version, offerVersion: offer.version, ...body },
    key,
  )

const offerState = async (offerId: string): Promise<Row> =>
  stack.first("select state, chosen_option, version::int as version from client_maturity_offers where id = $1", [offerId])

const maturityMailsOf = async (userId: string): Promise<Row[]> =>
  (
    await stack.pool.query<Row>(
      "select d.id, o.state as outbox_state, o.payload from email_deliveries d join outbox_events o on o.id = d.outbox_event_id " +
        "where d.user_id = $1 and d.template_key = 'maturity_options' order by d.created_at",
      [userId],
    )
  ).rows

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
        idempotencyRepository: createIdempotencyRepository(),
        clientGrowthRepository: createClientGrowthRepository(),
        notificationRepository: createNotificationRepository(),
      }
      registerAdminClientGrowthRoutes(instance, { ...shared, ...growthMailDeps(stack.crypto), config: GROWTH_CONFIG })
      registerMaturitySurface(instance, {
        ...shared,
        userRepository: stack.userRepository,
        maturityRepository: createMaturityRepository(),
        sipScheduleRepository: createAdminSipScheduleRepository(),
        outboxRepository: stack.outboxRepository,
        emailDeliveryRepository: stack.emailDeliveryRepository,
        crypto: stack.crypto,
        accessTokenService,
        clientWeb: { originAllowlist: [] },
        config: { idempotencyTtlMs: 86_400_000, cursorKey: randomBytes(32), sesConfigurationSet: "boe-transactional" },
      })
    },
  })
  finance = await signInRoleAdmin(app, stack, "finance")
  await seedFund()
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("sending maturity options and the client's choice", () => {
  test("nothing moves until the admin confirms, a replayed choice or confirm applies once, and confirming extends the SIP", async () => {
    const holding = await seedHolding()
    const sipId = await seedActiveSip(holding)
    const schedule = await scheduled(holding)
    const token = await clientToken(holding.userId)
    const money = await moneyCounts()
    const sips = await sipRows(holding.userId)

    const offer = await sent(holding, schedule)
    expect(offer).toMatchObject({ version: 1, chosenOption: null })
    const notice = await stack.first("select kind, payload from notifications where user_id = $1", [holding.userId])
    expect(notice).toEqual({
      kind: "maturity_options_sent",
      payload: { offerId: offer.offerId, scheduleId: schedule.scheduleId, fundId: holding.fundId },
    })
    expect(await maturityMailsOf(holding.userId)).toHaveLength(1)

    const key = randomUUID()
    const first = await choose(token, offer.offerId, "return_all", 1, key)
    expect(first.statusCode, first.body).toBe(200)
    const replay = await choose(token, offer.offerId, "return_all", 1, key)
    expect(replay.statusCode).toBe(200)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    expect(envelopeOf(replay).data).toEqual(envelopeOf(first).data)
    expect(await offerState(offer.offerId)).toEqual({ state: "open", chosen_option: "return_all", version: 2 })
    expect((await choose(token, offer.offerId, "sip_extension", 1)).statusCode).toBe(409)
    const changed = await choose(token, offer.offerId, "sip_extension", 2)
    expect(changed.statusCode, changed.body).toBe(200)
    expect(await stack.count("audit_events", "command = 'client_maturity_offer.chosen' and entity_id = $1", [offer.offerId])).toBe(2)

    expect(await moneyCounts()).toEqual(money)
    expect(await sipRows(holding.userId)).toEqual(sips)
    expect(await stack.count("client_maturity_schedules", "id = $1 and state = 'scheduled' and version = 1", [schedule.scheduleId])).toBe(1)

    const chosen = { ...offer, version: 3 }
    const mismatched = await confirm(holding, schedule, chosen, { option: "return_all", effectiveDate: MATURED_ON, amountPaise: "100000" })
    expect(mismatched.statusCode).toBe(409)
    expect((await confirm(holding, schedule, offer, { option: "sip_extension" })).statusCode).toBe(409)
    expect(await moneyCounts()).toEqual(money)
    expect(await sipRows(holding.userId)).toEqual(sips)

    const confirmKey = randomUUID()
    const confirmed = await confirm(holding, schedule, chosen, { option: "sip_extension" }, confirmKey)
    expect(confirmed.statusCode, confirmed.body).toBe(200)
    const result = envelopeOf<Resolution>(confirmed).data
    expect(result.schedule).toMatchObject({ state: "resolved", resolution: "sip_extension", followUpSipScheduleId: sipId, offer: null })
    expect(result).toMatchObject({ settlementEntryId: null, payoutId: null })
    expect(await stack.first("select state, month_count from admin_sip_schedules where id = $1", [sipId])).toEqual({
      state: "active",
      month_count: 24,
    })
    expect(
      await stack.first("select state, to_char(maturity_date, 'YYYY-MM-DD') as date from client_maturity_schedules where id = $1", [
        result.nextScheduleId,
      ]),
    ).toEqual({ state: "scheduled", date: NEXT_MATURITY })
    expect(await offerState(offer.offerId)).toEqual({ state: "confirmed", chosen_option: "sip_extension", version: 4 })

    const again = await confirm(holding, schedule, chosen, { option: "sip_extension" }, confirmKey)
    expect(envelopeOf(again).meta.idempotencyReplay).toBe(true)
    expect(envelopeOf(again).data).toEqual(result)
    expect(await stack.first("select month_count from admin_sip_schedules where id = $1", [sipId])).toEqual({ month_count: 24 })
    expect(await stack.count("client_maturity_schedules", "user_id = $1", [holding.userId])).toBe(2)
    expect(await moneyCounts()).toEqual(money)
    expect((await choose(token, offer.offerId, "return_all", 4)).statusCode).toBe(409)
  })

  test("a client cannot read or answer another client's offer", async () => {
    const owner = await seedHolding()
    await seedActiveSip(owner)
    const offer = await sent(owner, await scheduled(owner))
    const other = await seedHolding()
    const otherToken = await clientToken(other.userId)

    expect((await readOffer(otherToken, offer.offerId)).statusCode).toBe(404)
    expect((await choose(otherToken, offer.offerId, "return_all", 1)).statusCode).toBe(404)
    const list = await app.inject({ method: "GET", url: "/v1/client/maturity-options", headers: { authorization: `Bearer ${otherToken}` } })
    expect(envelopeOf<{ items: Offer[] }>(list).data.items).toEqual([])
    const anonymous = await app.inject({ method: "GET", url: `/v1/client/maturity-options/${offer.offerId}` })
    expect(anonymous.statusCode).toBe(401)
    expect(await offerState(offer.offerId)).toEqual({ state: "open", chosen_option: null, version: 1 })

    const ownerToken = await clientToken(owner.userId)
    expect(envelopeOf<{ offer: Offer }>(await readOffer(ownerToken, offer.offerId)).data.offer).toMatchObject({ state: "open" })
  })

  test("resolving directly closes the open offer, and sending again supersedes only the offer the admin saw", async () => {
    const holding = await seedHolding()
    const schedule = await scheduled(holding)
    const token = await clientToken(holding.userId)
    const superseded = await sent(holding, schedule, false)
    expect((await send(holding, schedule, false)).statusCode).toBe(409)
    expect((await choose(token, superseded.offerId, "return_all", 1)).statusCode).toBe(200)
    expect((await send(holding, schedule, false, 1)).statusCode).toBe(409)
    expect(await offerState(superseded.offerId)).toEqual({ state: "open", chosen_option: "return_all", version: 2 })
    const current = await sent(holding, schedule, false, 2)
    expect(await offerState(superseded.offerId)).toMatchObject({ state: "superseded" })
    expect((await choose(token, superseded.offerId, "return_all", 2)).statusCode).toBe(409)
    expect((await choose(token, current.offerId, "sip_extension", 1)).statusCode).toBe(400)

    const resolved = await adminPost(`${scheduleUrl(holding, schedule)}/resolve`, {
      resolution: "return_all",
      expectedVersion: 1,
      effectiveDate: MATURED_ON,
      amountPaise: String(INVESTED),
    })
    expect(resolved.statusCode, resolved.body).toBe(200)
    expect(envelopeOf<Resolution>(resolved).data.schedule.offer).toBeNull()
    expect(await offerState(current.offerId)).toMatchObject({ state: "closed" })
    expect(envelopeOf<{ offer: Offer }>(await readOffer(token, current.offerId)).data.offer.state).toBe("closed")
  })
})

describe("refusals before anything moves", () => {
  test("a closed client gets no options and no SIP extension, even when an offer was already chosen", async () => {
    const holding = await seedHolding()
    const sipId = await seedActiveSip(holding)
    const schedule = await scheduled(holding)
    const offer = await sent(holding, schedule)
    const token = await clientToken(holding.userId)
    expect((await choose(token, offer.offerId, "sip_extension", 1)).statusCode).toBe(200)
    await stack.setAccountState(holding.userId, "closed")
    await stack.pool.query("update users set pii_tombstoned_at = now() where id = $1", [holding.userId])
    const before = await moneyCounts()

    const confirmed = await confirm(holding, schedule, { ...offer, version: 2 }, { option: "sip_extension" })
    expect(confirmed.statusCode).toBe(409)
    const resolved = await adminPost(`${scheduleUrl(holding, schedule)}/resolve`, { resolution: "sip_extension", expectedVersion: 1, extension })
    expect(resolved.statusCode).toBe(409)
    const resent = await send(holding, schedule, true, 2)
    expect(resent.statusCode).toBe(409)
    expect(envelopeOf(resent).error.message).toMatch(/active client account/u)

    expect(await stack.first("select month_count, version::int as version from admin_sip_schedules where id = $1", [sipId])).toEqual({
      month_count: 12,
      version: 1,
    })
    expect(await stack.count("client_maturity_schedules", "user_id = $1", [holding.userId])).toBe(1)
    expect(await stack.count("client_maturity_schedules", "id = $1 and state = 'scheduled' and version = 1", [schedule.scheduleId])).toBe(1)
    expect(await offerState(offer.offerId)).toEqual({ state: "open", chosen_option: "sip_extension", version: 2 })
    expect(await moneyCounts()).toEqual(before)
  })

  test("confirming before the client has chosen is refused", async () => {
    const holding = await seedHolding()
    const schedule = await scheduled(holding)
    const offer = await sent(holding, schedule, false)
    const refused = await confirm(holding, schedule, offer, { option: "return_all", effectiveDate: MATURED_ON, amountPaise: String(INVESTED) })
    expect(refused.statusCode).toBe(409)
    expect(envelopeOf(refused).error.message).toMatch(/has not chosen/u)
    expect(await offerState(offer.offerId)).toEqual({ state: "open", chosen_option: null, version: 1 })
    expect(await stack.count("client_value_entries", "user_id = $1", [holding.userId])).toBe(1)
  })
})

describe("extending the SIP", () => {
  test("is refused without an active SIP schedule, both when sending and when resolving", async () => {
    const holding = await seedHolding()
    const schedule = await scheduled(holding)
    const before = await moneyCounts()

    const offered = await send(holding, schedule)
    expect(offered.statusCode).toBe(409)
    expect(envelopeOf(offered).error.message).toMatch(/no active SIP schedule/u)
    const resolved = await adminPost(`${scheduleUrl(holding, schedule)}/resolve`, { resolution: "sip_extension", expectedVersion: 1, extension })
    expect(resolved.statusCode).toBe(409)
    expect(await stack.count("client_maturity_offers", "user_id = $1", [holding.userId])).toBe(0)
    expect(await stack.count("client_maturity_schedules", "id = $1 and state = 'scheduled'", [schedule.scheduleId])).toBe(1)
    expect(await moneyCounts()).toEqual(before)
  })

  test("stays within 600 months and requires a later maturity date", async () => {
    const holding = await seedHolding()
    const sipId = await seedActiveSip(holding, 590)
    const schedule = await scheduled(holding)
    const resolveWith = (months: number, nextMaturityDate = NEXT_MATURITY) =>
      adminPost(`${scheduleUrl(holding, schedule)}/resolve`, {
        resolution: "sip_extension",
        expectedVersion: 1,
        extension: { months, nextMaturityDate },
      })

    const over = await resolveWith(11)
    expect(over.statusCode).toBe(400)
    expect(envelopeOf(over).error.fields?.["extension.months"]?.join(" ")).toMatch(/at most 10/u)
    expect((await resolveWith(10, MATURED_ON)).statusCode).toBe(400)
    expect(await stack.first("select month_count from admin_sip_schedules where id = $1", [sipId])).toEqual({ month_count: 590 })

    const full = await resolveWith(10)
    expect(full.statusCode, full.body).toBe(200)
    expect(await stack.first("select month_count from admin_sip_schedules where id = $1", [sipId])).toEqual({ month_count: 600 })
  })

  test("rolls back the SIP change and the resolution when the next maturity cannot be scheduled", async () => {
    const holding = await seedHolding()
    const sipId = await seedActiveSip(holding)
    const schedule = await scheduled(holding)
    const audits = await stack.count("audit_events")
    const body = { resolution: "sip_extension", expectedVersion: 1, extension }
    const key = randomUUID()

    await stack.pool.query(
      "CREATE FUNCTION refuse_next_maturity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected maturity failure'; END $$",
    )
    await stack.pool.query(
      "CREATE TRIGGER refuse_next_maturity BEFORE INSERT ON client_maturity_schedules FOR EACH ROW EXECUTE FUNCTION refuse_next_maturity()",
    )
    try {
      expect((await adminPost(`${scheduleUrl(holding, schedule)}/resolve`, body, key)).statusCode).toBe(500)
    } finally {
      await stack.pool.query("DROP TRIGGER refuse_next_maturity ON client_maturity_schedules")
      await stack.pool.query("DROP FUNCTION refuse_next_maturity()")
    }
    expect(await stack.first("select month_count, version::int as version from admin_sip_schedules where id = $1", [sipId])).toEqual({
      month_count: 12,
      version: 1,
    })
    expect(await stack.count("client_maturity_schedules", "id = $1 and state = 'scheduled' and version = 1", [schedule.scheduleId])).toBe(1)
    expect(await stack.count("audit_events")).toBe(audits)

    const retried = await adminPost(`${scheduleUrl(holding, schedule)}/resolve`, body, key)
    expect(retried.statusCode, retried.body).toBe(200)
    expect(await stack.first("select month_count from admin_sip_schedules where id = $1", [sipId])).toEqual({ month_count: 24 })
  })
})

describe("maturity options email", () => {
  test("sends an open offer's mail without amounts and cancels it for a closed offer, a closed account or a changed email", async () => {
    const kept = await seedHolding()
    const withdrawn = await seedHolding()
    const resent = await seedHolding()
    const keptOffer = await sent(kept, await scheduled(kept), false)
    const withdrawnSchedule = await scheduled(withdrawn)
    const withdrawnOffer = await sent(withdrawn, withdrawnSchedule, false)
    const resentSchedule = await scheduled(resent)
    const firstOffer = await sent(resent, resentSchedule, false)
    await sent(resent, resentSchedule, false, firstOffer.version)
    const moved = await seedHolding()
    const closed = await seedHolding()
    await sent(moved, await scheduled(moved), false)
    await sent(closed, await scheduled(closed), false)
    await stack.pool.query("update users set email_revision = email_revision + 1 where id = $1", [moved.userId])
    await stack.setAccountState(closed.userId, "closed")
    const withdrawal = await adminPost(`${scheduleUrl(withdrawn, withdrawnSchedule)}/offers/${withdrawnOffer.offerId}/withdraw`, {
      expectedVersion: 1,
      offerVersion: 1,
    })
    expect(withdrawal.statusCode, withdrawal.body).toBe(200)
    expect(await offerState(keptOffer.offerId)).toMatchObject({ state: "open" })

    const transport = stack.transport()
    const guard = createMaturityOptionsGuard({
      maturityOfferRepository: createClientMaturityOfferRepository(),
      userRepository: stack.userRepository,
    })
    await stack.dispatch(transport, stack.clock, stack.crypto, [["maturity_options", guard]])

    const keptMail = transport.messages.filter((message) => message.to === kept.email)
    expect(keptMail).toHaveLength(1)
    expect(keptMail[0]?.subject).toBe("Your maturity options are ready")
    expect(keptMail[0]?.text).toContain(`Your investment in ${FUND_NAME} matures on 31 December 2025.`)
    expect(keptMail[0]?.text).not.toMatch(/₹|[0-9],[0-9]{3}/u)
    for (const holding of [withdrawn, moved, closed]) {
      expect(transport.messages.some((message) => message.to === holding.email), holding.email).toBe(false)
      expect((await maturityMailsOf(holding.userId)).map((row) => row.outbox_state)).toEqual(["cancelled"])
    }
    expect((await maturityMailsOf(resent.userId)).map((row) => row.outbox_state)).toEqual(["cancelled", "delivered"])
    expect(transport.messages.filter((message) => message.to === resent.email)).toHaveLength(1)
  })
})
