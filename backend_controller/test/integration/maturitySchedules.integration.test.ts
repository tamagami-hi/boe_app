import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientMaturityOfferRepository } from "../../src/repositories/clientMaturityOfferRepository.js"
import { createClientMaturityScheduleRepository } from "../../src/repositories/clientMaturityScheduleRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createMaturityRepository } from "../../src/repositories/maturityRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminMaturityRoutes } from "../../src/routes/adminMaturityRoutes.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerAdminMaturityScheduleRoutes } from "../../src/routes/adminMaturityScheduleRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import {
  ADMIN_ORIGIN,
  adminHeaders,
  adminWebAuth,
  registerAdminLogin,
  signInRoleAdmin,
  type AdminSession,
} from "./adminSessionSupport.js"
import { GROWTH_CONFIG, growthMailDeps } from "./growthMailSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

interface Envelope<T> {
  readonly data: T
  readonly meta: { readonly idempotencyReplay?: boolean; readonly page?: { readonly nextCursor: string | null } }
  readonly error: { readonly code: string; readonly fields?: Record<string, readonly string[]> }
}

interface Schedule {
  readonly scheduleId: string
  readonly maturityDate: string
  readonly state: string
  readonly resolution: string | null
  readonly dueStatus: string
  readonly daysUntil: number
  readonly maturityId: string | null
  readonly followUpSipScheduleId: string | null
  readonly version: number
}

interface Resolution {
  readonly schedule: Schedule
  readonly settlementEntryId: string | null
  readonly payoutId: string | null
  readonly closedSipScheduleId: string | null
  readonly nextScheduleId: string | null
}

interface DueList {
  readonly asOf: string
  readonly dueThrough: string
  readonly windowDays: number
  readonly total: number
  readonly items: readonly Schedule[]
}

type Holding = Readonly<{ userId: string; fundId: string }>

const MONEY_TABLES = [
  "client_value_entries",
  "client_position_maturities",
  "withdrawal_operations",
  "investment_orders",
  "payments",
  "admin_sip_schedules",
  "notifications",
] as const
const INVESTED_ON = "2025-01-15"
const GROWTH_ON = "2025-06-02"
const MATURED_ON = "2025-12-31"
const INVESTED = 100_000
const GROWTH = "20000"

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let support: AdminSession
let fundId: string
let fundVersionId: string
let fixedClock: Date | null = null

const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

const moneyCounts = async (): Promise<number[]> => Promise.all(MONEY_TABLES.map((table) => stack.count(table)))

const seedFund = async (): Promise<void> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`maturity-${randomUUID().slice(0, 8)}`, finance.userId],
  )
  const disclosure = await stack.first(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fund.id, randomBytes(32), finance.userId],
  )
  const version = await stack.first(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id, created_at) " +
      "values ($1, 1, 'Maturity Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4, '2024-01-01') returning id",
    [fund.id, disclosure.id, randomBytes(32), finance.userId],
  )
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [version.id, fund.id])
  fundId = String(fund.id)
  fundVersionId = String(version.id)
}

const seedHolding = async (growth: string | null = null): Promise<Holding> => {
  const userId = (await stack.seedUser()).id
  const order = await stack.first(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'lump_sum', 'accepted', $4, now()) returning id",
    [userId, fundId, fundVersionId, INVESTED],
  )
  const payment = await stack.first(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, $3, 'succeeded', now()) returning id",
    [order.id, userId, INVESTED],
  )
  const allocation = await stack.first(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, $5, $6) returning id",
    [order.id, userId, fundId, INVESTED, finance.userId, randomUUID()],
  )
  await stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', $4, $4, $5, $6, $7, 'investment_accepted', 'admin', $8, $9)",
    [userId, fundId, allocation.id, INVESTED, INVESTED_ON, order.id, payment.id, finance.userId, randomUUID()],
  )
  if (growth !== null) await growBy({ userId, fundId }, growth, GROWTH_ON)
  return { userId, fundId }
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

const sums = async (holding: Holding): Promise<{ principal: string; value: string }> => {
  const row = await stack.first(
    "select coalesce(sum(principal_delta_paise), 0)::text as principal, coalesce(sum(value_delta_paise), 0)::text as value " +
      "from client_value_entries where user_id = $1 and fund_id = $2",
    [holding.userId, holding.fundId],
  )
  return { principal: String(row.principal), value: String(row.value) }
}

const setDate = (holding: Holding, maturityDate: string, session = finance, key = randomUUID()) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/clients/${holding.userId}/maturity-schedules`,
    headers: adminHeaders(session, key),
    payload: { fundId: holding.fundId, maturityDate },
  })

const scheduled = async (holding: Holding, maturityDate: string): Promise<Schedule> => {
  const response = await setDate(holding, maturityDate)
  expect(response.statusCode, response.body).toBe(201)
  return envelopeOf<{ schedule: Schedule }>(response).data.schedule
}

const resolve = (holding: Holding, schedule: Schedule, body: Record<string, unknown>, key = randomUUID(), session = finance) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/clients/${holding.userId}/maturity-schedules/${schedule.scheduleId}/resolve`,
    headers: adminHeaders(session, key),
    payload: { expectedVersion: schedule.version, ...body },
  })

const shiftMonth = (month: string, by: number): string => {
  const [year, number] = month.split("-").map(Number) as [number, number]
  const index = year * 12 + number - 1 + by
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`
}

const INDIA_MONTH = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7)
const SIP_START = shiftMonth(INDIA_MONTH, 1)
const followUp = { monthlyAmountPaise: "300000", startMonth: SIP_START, monthCount: 24 }
const extension = { months: 12, nextMaturityDate: "2026-12-31" }
const figures = (principal: number, value: number) => ({
  expectedPrincipalPaise: String(principal),
  expectedCurrentValuePaise: String(value),
})

const growBy = async (holding: Holding, growthPaise: string, effectiveDate: string): Promise<void> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/client-growth/individual",
    headers: adminHeaders(finance, randomUUID()),
    payload: { ...holding, growthPaise, effectiveDate, reasonCode: "valuation_update" },
  })
  expect(response.statusCode, response.body).toBe(201)
}

const readAs = (session: AdminSession, url: string) => app.inject({ method: "GET", url, headers: adminHeaders(session) })

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      const shared = {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        auditRepository: stack.auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
        clientGrowthRepository: createClientGrowthRepository(),
        notificationRepository: createNotificationRepository(),
      }
      registerAdminClientGrowthRoutes(instance, { ...shared, ...growthMailDeps(stack.crypto), clock: stack.clock, config: GROWTH_CONFIG })
      registerAdminMaturityRoutes(instance, {
        ...shared,
        clock: stack.clock,
        maturityRepository: createMaturityRepository(),
        config: { idempotencyTtlMs: 86_400_000 },
      })
      registerAdminMaturityScheduleRoutes(instance, {
        ...shared,
        clock: () => fixedClock ?? stack.clock(),
        userRepository: stack.userRepository,
        maturityRepository: createMaturityRepository(),
        sipScheduleRepository: createAdminSipScheduleRepository(),
        maturityScheduleRepository: createClientMaturityScheduleRepository(),
        maturityOfferRepository: createClientMaturityOfferRepository(),
        config: { idempotencyTtlMs: 86_400_000, cursorKey: randomBytes(32) },
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

describe("maturity dates", () => {
  test("setting, editing, cancelling and reading dates moves no money and keeps one open date per holding", async () => {
    const holding = await seedHolding(GROWTH)
    const overdue = await seedHolding(GROWTH)
    const before = await moneyCounts()
    const balance = await sums(holding)

    const created = await scheduled(holding, "2031-03-31")
    expect(created).toMatchObject({ state: "scheduled", resolution: null, version: 1, dueStatus: "upcoming" })
    const late = await scheduled(overdue, MATURED_ON)
    expect(late.dueStatus).toBe("overdue")

    const duplicate = await setDate(holding, "2032-01-01")
    expect(duplicate.statusCode).toBe(409)
    expect(envelopeOf(duplicate).error.code).toBe("STATE_CONFLICT")

    const editUrl = `/v1/admin/clients/${holding.userId}/maturity-schedules/${created.scheduleId}`
    const edit = (expectedVersion: number, maturityDate: string) =>
      app.inject({ method: "PATCH", url: editUrl, headers: adminHeaders(finance, randomUUID()), payload: { expectedVersion, maturityDate } })
    expect((await edit(2, "2031-06-30")).statusCode).toBe(409)
    const edited = await edit(1, "2031-06-30")
    expect(edited.statusCode, edited.body).toBe(200)
    expect(envelopeOf<{ schedule: Schedule }>(edited).data.schedule).toMatchObject({ maturityDate: "2031-06-30", version: 2 })

    for (const url of ["/v1/admin/maturities/due", "/v1/admin/maturities", `/v1/admin/clients/${overdue.userId}/maturity-schedules`]) {
      expect((await readAs(finance, url)).statusCode).toBe(200)
    }

    const cancel = (expectedVersion: number) =>
      app.inject({ method: "POST", url: `${editUrl}/cancel`, headers: adminHeaders(finance, randomUUID()), payload: { expectedVersion } })
    const cancelled = await cancel(2)
    expect(cancelled.statusCode, cancelled.body).toBe(200)
    expect(envelopeOf<{ schedule: Schedule }>(cancelled).data.schedule).toMatchObject({ state: "cancelled", dueStatus: "closed", version: 3 })
    expect((await cancel(3)).statusCode).toBe(409)
    expect((await edit(3, "2031-09-30")).statusCode).toBe(409)
    expect((await setDate(holding, "2032-01-01")).statusCode).toBe(201)

    const notHeld = await setDate({ userId: holding.userId, fundId: randomUUID() }, "2031-01-01")
    expect(notHeld.statusCode).toBe(400)
    expect(envelopeOf(notHeld).error.fields?.fundId).toBeDefined()

    expect(await moneyCounts()).toEqual(before)
    expect(await sums(holding)).toEqual(balance)
    expect(await stack.count("client_maturity_schedules", "user_id = $1 and state = 'scheduled'", [overdue.userId])).toBe(1)
    const audit = await stack.pool.query<{ command: string }>(
      "select command from audit_events where entity_type = 'client_maturity_schedule' and metadata->>'userId' = $1 order by occurred_at",
      [holding.userId],
    )
    expect(audit.rows.map((row) => row.command)).toEqual([
      "client_maturity_schedule.created",
      "client_maturity_schedule.updated",
      "client_maturity_schedule.cancelled",
      "client_maturity_schedule.created",
    ])
  })

  test("only maturity managers read or change dates, with CSRF and an idempotency key on every write", async () => {
    const holding = await seedHolding()
    const schedule = await scheduled(holding, MATURED_ON)
    const before = await moneyCounts()

    for (const url of ["/v1/admin/maturities/due", "/v1/admin/maturities", `/v1/admin/clients/${holding.userId}/maturity-schedules`]) {
      const denied = await readAs(support, url)
      expect(denied.statusCode, url).toBe(403)
      expect(envelopeOf(denied).error.code).toBe("AUTHORIZATION_DENIED")
    }
    expect((await setDate(holding, "2030-01-01", support)).statusCode).toBe(403)
    const deniedResolve = await resolve(holding, schedule, { resolution: "sip_extension", extension }, randomUUID(), support)
    expect(deniedResolve.statusCode).toBe(403)

    const url = `/v1/admin/clients/${holding.userId}/maturity-schedules/${schedule.scheduleId}/resolve`
    const payload = { resolution: "sip_extension", expectedVersion: 1, extension }
    const noKey = await app.inject({ method: "POST", url, headers: adminHeaders(finance), payload })
    expect(noKey.statusCode).toBe(400)
    const noCsrf = await app.inject({
      method: "POST",
      url,
      headers: { origin: ADMIN_ORIGIN, cookie: finance.cookie, "idempotency-key": randomUUID() },
      payload,
    })
    expect(noCsrf.statusCode).toBe(403)

    expect(await moneyCounts()).toEqual(before)
    expect(await stack.count("client_maturity_schedules", "id = $1 and state = 'scheduled' and version = 1", [schedule.scheduleId])).toBe(1)
  })

  test("the due list runs 30 days from today's date in India, overdue dates included", async () => {
    const holdings = await Promise.all([seedHolding(), seedHolding(), seedHolding(), seedHolding()])
    const [overdue, today, lastDay, nextDay] = await Promise.all([
      scheduled(holdings[0], "2026-03-31"),
      scheduled(holdings[1], "2026-04-01"),
      scheduled(holdings[2], "2026-05-01"),
      scheduled(holdings[3], "2026-05-02"),
    ])
    fixedClock = new Date("2026-03-31T19:00:00.000Z")
    try {
      const response = await readAs(finance, "/v1/admin/maturities/due?limit=100")
      expect(response.statusCode, response.body).toBe(200)
      const due = envelopeOf<DueList>(response).data
      expect(due).toMatchObject({ asOf: "2026-04-01", dueThrough: "2026-05-01", windowDays: 30 })
      const byId = new Map(due.items.map((item) => [item.scheduleId, item]))
      expect(byId.get(overdue.scheduleId)).toMatchObject({ dueStatus: "overdue", daysUntil: -1 })
      expect(byId.get(today.scheduleId)).toMatchObject({ dueStatus: "due_soon", daysUntil: 0 })
      expect(byId.get(lastDay.scheduleId)).toMatchObject({ dueStatus: "due_soon", daysUntil: 30 })
      expect(byId.has(nextDay.scheduleId)).toBe(false)
      expect(due.total).toBe(due.items.length)

      const page = await readAs(finance, "/v1/admin/maturities?limit=100")
      const dashboard = envelopeOf<{ items: Schedule[] }>(page).data.items
      expect(dashboard.find((item) => item.scheduleId === nextDay.scheduleId)).toMatchObject({ dueStatus: "upcoming", daysUntil: 31 })
      const dates = dashboard.map((item) => item.maturityDate)
      expect(dates).toEqual([...dates].sort())
    } finally {
      fixedClock = null
    }
  })
})

describe("maturity resolutions", () => {
  test("return all withdraws exactly the current value once and links the settled maturity", async () => {
    const holding = await seedHolding(GROWTH)
    const schedule = await scheduled(holding, MATURED_ON)
    const before = await moneyCounts()

    const changed = await resolve(holding, schedule, { resolution: "return_all", effectiveDate: MATURED_ON, amountPaise: "119999" })
    expect(changed.statusCode).toBe(409)
    expect(await moneyCounts()).toEqual(before)

    const key = randomUUID()
    const body = { resolution: "return_all", effectiveDate: MATURED_ON, amountPaise: "120000" }
    const response = await resolve(holding, schedule, body, key)
    expect(response.statusCode, response.body).toBe(200)
    const result = envelopeOf<Resolution>(response).data
    expect(result.schedule).toMatchObject({ state: "resolved", resolution: "return_all", followUpSipScheduleId: null, version: 2 })
    expect(result.closedSipScheduleId).toBeNull()

    const maturity = await stack.first("select * from client_position_maturities where id = $1", [result.schedule.maturityId])
    expect(maturity).toMatchObject({ state: "settled", settlement: "withdrawal", settlement_entry_id: result.settlementEntryId })
    const entry = await stack.first("select * from client_value_entries where id = $1", [result.settlementEntryId])
    expect(entry).toMatchObject({ entry_type: "withdrawal", principal_delta_paise: "-100000", value_delta_paise: "-120000" })
    const payout = await stack.first("select * from withdrawal_operations where id = $1", [result.payoutId])
    expect(payout).toMatchObject({ state: "pending", amount_paise: "120000", growth_portion_paise: "20000", principal_portion_paise: "100000" })
    expect(await sums(holding)).toEqual({ principal: "0", value: "0" })
    const after = await moneyCounts()
    expect(after.slice(0, 3)).toEqual([before[0]! + 1, before[1]! + 1, before[2]! + 1])

    const replay = await resolve(holding, schedule, body, key)
    expect(replay.statusCode).toBe(200)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    expect(envelopeOf(replay).data).toEqual(result)
    expect((await resolve(holding, schedule, body)).statusCode).toBe(409)
    expect(await moneyCounts()).toEqual(after)
  })

  test("one-time investment reinvests the growth, closes the active SIP and starts the new one atomically", async () => {
    const holding = await seedHolding(GROWTH)
    const oldSip = await seedActiveSip(holding)
    const schedule = await scheduled(holding, MATURED_ON)
    const before = await moneyCounts()
    const audits = await stack.count("audit_events")
    const body = { resolution: "one_time_and_sip", effectiveDate: MATURED_ON, ...figures(INVESTED, 120_000), sip: followUp }

    for (const [startMonth, message] of [
      ["2025-12", /after the maturity month/u],
      [shiftMonth(INDIA_MONTH, -1), /earlier than the current month/u],
    ] as const) {
      const early = await resolve(holding, schedule, { ...body, sip: { ...followUp, startMonth } })
      expect(early.statusCode).toBe(400)
      expect(envelopeOf(early).error.fields?.["sip.startMonth"]?.join(" ")).toMatch(message)
    }

    const key = randomUUID()
    await stack.pool.query("CREATE SEQUENCE test_reinvested_before_sip")
    await stack.pool.query(
      "CREATE FUNCTION refuse_test_sip() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN " +
        "IF EXISTS (SELECT 1 FROM client_value_entries WHERE user_id = NEW.user_id AND entry_type = 'maturity_reinvestment') " +
        "THEN PERFORM nextval('test_reinvested_before_sip'); END IF; " +
        "RAISE EXCEPTION 'injected sip failure'; END $$",
    )
    await stack.pool.query("CREATE TRIGGER refuse_test_sip BEFORE INSERT ON admin_sip_schedules FOR EACH ROW EXECUTE FUNCTION refuse_test_sip()")
    try {
      expect((await resolve(holding, schedule, body, key)).statusCode).toBe(500)
      expect(await stack.first("select is_called from test_reinvested_before_sip", [])).toEqual({ is_called: true })
    } finally {
      await stack.pool.query("DROP TRIGGER refuse_test_sip ON admin_sip_schedules")
      await stack.pool.query("DROP FUNCTION refuse_test_sip()")
      await stack.pool.query("DROP SEQUENCE test_reinvested_before_sip")
    }
    expect(await moneyCounts()).toEqual(before)
    expect(await stack.count("audit_events")).toBe(audits)
    expect(await stack.count("admin_sip_schedules", "id = $1 and state = 'active'", [oldSip])).toBe(1)
    expect(await stack.count("client_maturity_schedules", "id = $1 and state = 'scheduled'", [schedule.scheduleId])).toBe(1)

    const response = await resolve(holding, schedule, body, key)
    expect(response.statusCode, response.body).toBe(200)
    const result = envelopeOf<Resolution>(response).data
    expect(result).toMatchObject({ payoutId: null, closedSipScheduleId: oldSip })
    expect(result.schedule).toMatchObject({ state: "resolved", resolution: "one_time_and_sip" })
    const entry = await stack.first("select * from client_value_entries where id = $1", [result.settlementEntryId])
    expect(entry).toMatchObject({ entry_type: "maturity_reinvestment", principal_delta_paise: "20000", value_delta_paise: "0" })
    expect(await stack.first("select state, settlement from client_position_maturities where id = $1", [result.schedule.maturityId])).toEqual({
      state: "settled",
      settlement: "reinvestment",
    })
    expect(await sums(holding)).toEqual({ principal: "120000", value: "120000" })
    expect(await stack.first("select state from admin_sip_schedules where id = $1", [oldSip])).toEqual({ state: "closed" })
    const newSip = await stack.first(
      "select state, monthly_amount_paise, to_char(start_month, 'YYYY-MM') as start, month_count from admin_sip_schedules where id = $1",
      [result.schedule.followUpSipScheduleId],
    )
    expect(newSip).toEqual({ state: "active", monthly_amount_paise: "300000", start: SIP_START, month_count: 24 })
    expect(await stack.count("withdrawal_operations", "user_id = $1", [holding.userId])).toBe(0)

    const after = await moneyCounts()
    const replay = await resolve(holding, schedule, body, key)
    expect(envelopeOf(replay).data).toEqual(result)
    expect(await moneyCounts()).toEqual(after)
  })

  test("with no growth the one-time option writes no ledger row, and extending the SIP never writes one", async () => {
    const flat = await seedHolding()
    const grown = await seedHolding(GROWTH)
    const grownSip = await seedActiveSip(grown)
    const flatSchedule = await scheduled(flat, MATURED_ON)
    const grownSchedule = await scheduled(grown, MATURED_ON)
    const entries = await stack.count("client_value_entries")
    const maturities = await stack.count("client_position_maturities")

    const oneTime = await resolve(flat, flatSchedule, {
      resolution: "one_time_and_sip",
      effectiveDate: MATURED_ON,
      ...figures(INVESTED, INVESTED),
      sip: followUp,
    })
    expect(oneTime.statusCode, oneTime.body).toBe(200)
    expect(envelopeOf<Resolution>(oneTime).data).toMatchObject({ settlementEntryId: null, payoutId: null, closedSipScheduleId: null })
    expect(envelopeOf<Resolution>(oneTime).data.schedule.maturityId).toBeNull()

    const key = randomUUID()
    const sipBody = { resolution: "sip_extension", extension }
    const extended = await resolve(grown, grownSchedule, sipBody, key)
    expect(extended.statusCode, extended.body).toBe(200)
    const result = envelopeOf<Resolution>(extended).data
    expect(result).toMatchObject({ settlementEntryId: null, payoutId: null, closedSipScheduleId: null })
    expect(result.schedule).toMatchObject({ resolution: "sip_extension", maturityId: null, followUpSipScheduleId: grownSip })
    expect(await stack.first("select state, month_count from admin_sip_schedules where id = $1", [grownSip])).toEqual({
      state: "active",
      month_count: 24,
    })
    expect(envelopeOf(await resolve(grown, grownSchedule, sipBody, key)).data).toEqual(result)
    expect(await stack.first("select month_count from admin_sip_schedules where id = $1", [grownSip])).toEqual({ month_count: 24 })

    expect(await stack.count("client_value_entries")).toBe(entries)
    expect(await stack.count("client_position_maturities")).toBe(maturities)
    expect(await sums(flat)).toEqual({ principal: "100000", value: "100000" })
    expect(await sums(grown)).toEqual({ principal: "100000", value: "120000" })
  })

  test("a value update between reading the holding and confirming refuses the one-time option without writing", async () => {
    const holding = await seedHolding(GROWTH)
    const schedule = await scheduled(holding, MATURED_ON)
    const seen = figures(INVESTED, 120_000)
    await growBy(holding, "5000", "2025-07-01")
    const before = await moneyCounts()
    const audits = await stack.count("audit_events")

    const stale = await resolve(holding, schedule, { resolution: "one_time_and_sip", effectiveDate: MATURED_ON, ...seen, sip: followUp })
    expect(stale.statusCode).toBe(409)
    expect(envelopeOf(stale).error.code).toBe("STATE_CONFLICT")
    expect(await moneyCounts()).toEqual(before)
    expect(await stack.count("audit_events")).toBe(audits)
    expect(await stack.count("client_maturity_schedules", "id = $1 and state = 'scheduled' and version = 1", [schedule.scheduleId])).toBe(1)

    const fresh = await resolve(holding, schedule, {
      resolution: "one_time_and_sip",
      effectiveDate: MATURED_ON,
      ...figures(INVESTED, 125_000),
      sip: followUp,
    })
    expect(fresh.statusCode, fresh.body).toBe(200)
    const entry = await stack.first("select principal_delta_paise from client_value_entries where id = $1", [
      envelopeOf<Resolution>(fresh).data.settlementEntryId,
    ])
    expect(entry).toEqual({ principal_delta_paise: "25000" })
  })

  test("a holding settled by hand in the Maturity tab is refused with a pointer to cancel the date", async () => {
    const holding = await seedHolding(GROWTH)
    const schedule = await scheduled(holding, MATURED_ON)
    const url = `/v1/admin/clients/${holding.userId}/maturities`
    const marked = await app.inject({
      method: "POST",
      url,
      headers: adminHeaders(finance, randomUUID()),
      payload: { fundId: holding.fundId, maturedOn: MATURED_ON, reasonCode: "position_matured" },
    })
    expect(marked.statusCode, marked.body).toBe(201)
    const withdrawn = await app.inject({
      method: "POST",
      url: `${url}/${envelopeOf<{ maturityId: string }>(marked).data.maturityId}/withdrawal`,
      headers: adminHeaders(finance, randomUUID()),
      payload: { fundId: holding.fundId, effectiveDate: MATURED_ON, amountPaise: "50000", reasonCode: "maturity_withdrawal" },
    })
    expect(withdrawn.statusCode, withdrawn.body).toBe(201)
    const before = await moneyCounts()

    const refused = await resolve(holding, schedule, { resolution: "sip_extension", extension })
    expect(refused.statusCode).toBe(409)
    expect(refused.json<{ error: { message: string } }>().error.message).toMatch(/already settled.*Cancel this maturity date/u)
    expect(await moneyCounts()).toEqual(before)

    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${holding.userId}/maturity-schedules/${schedule.scheduleId}/cancel`,
      headers: adminHeaders(finance, randomUUID()),
      payload: { expectedVersion: 1 },
    })
    expect(cancelled.statusCode, cancelled.body).toBe(200)
    expect(await moneyCounts()).toEqual(before)
  })

  test("a maturity date that has not arrived cannot be resolved", async () => {
    const holding = await seedHolding(GROWTH)
    const schedule = await scheduled(holding, "2199-06-30")
    const before = await moneyCounts()
    const response = await resolve(holding, schedule, {
      resolution: "sip_extension",
      extension: { months: 6, nextMaturityDate: "2199-12-31" },
    })
    expect(response.statusCode).toBe(409)
    expect(envelopeOf(response).error.code).toBe("STATE_CONFLICT")
    expect(await moneyCounts()).toEqual(before)
    expect(await stack.count("client_maturity_schedules", "id = $1 and state = 'scheduled'", [schedule.scheduleId])).toBe(1)
  })
})
