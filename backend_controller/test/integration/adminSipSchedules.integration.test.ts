import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { createRecordingCategoryRepository } from "../../src/repositories/recordingCategoryRepository.js"
import { createClientReceiptRepository } from "../../src/repositories/clientReceiptRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminClientPositionRoutes } from "../../src/routes/adminClientPositionRoutes.js"
import { registerAdminSipScheduleRoutes } from "../../src/routes/adminSipScheduleRoutes.js"
import { registerClientReceiptRoutes } from "../../src/routes/clientReceiptRoutes.js"
import { registerClientSipScheduleRoutes } from "../../src/routes/clientSipScheduleRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

interface Envelope<T> {
  readonly data: T
  readonly meta: { readonly idempotencyReplay?: boolean; readonly page?: { readonly nextCursor: string | null; readonly hasMore: boolean } }
  readonly error: { readonly code: string; readonly fields?: Record<string, readonly string[]> }
}

interface Schedule {
  readonly scheduleId: string
  readonly version: number
  readonly state: string
  readonly monthCount: number
  readonly monthsPaid: number
  readonly monthsDue: number
  readonly nextUnpaidMonth: string | null
  readonly paidMonths: readonly string[]
}

interface FundSchedule extends Schedule {
  readonly clientName: string
}

interface ClientSchedule {
  readonly scheduleId: string
  readonly fundId: string
  readonly monthlyAmountPaise: string
  readonly totalMonths: number
  readonly monthsPaid: number
  readonly state: string
}

type Link = Readonly<{ scheduleId: string; month: string }>

const EFFECTIVE_DATE = "2025-06-02"
const MONTHLY = "recorded_offline_monthly_investment"
const WRITE_TABLES = [
  "investment_orders",
  "payments",
  "client_value_entries",
  "notifications",
  "outbox_events",
  "audit_events",
  "idempotency_records",
  "admin_sip_schedules",
  "admin_sip_schedule_months",
] as const

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let support: AdminSession
let accessTokenService: AccessTokenService
let fundId: string
let otherFundId: string

const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

const writeCounts = async (): Promise<number[]> => Promise.all(WRITE_TABLES.map((table) => stack.count(table)))

const shiftMonth = (month: string, by: number): string => {
  const [year, number] = month.split("-").map(Number) as [number, number]
  const index = year * 12 + number - 1 + by
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`
}

const indiaMonthNow = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7)

const seedFund = async (name: string): Promise<string> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`sip-${randomUUID().slice(0, 8)}`, finance.userId],
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
    [fund.id, name, disclosure.id, randomBytes(32), finance.userId],
  )
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [version.id, fund.id])
  return String(fund.id)
}

const clientToken = async (userId: string): Promise<string> => {
  const session = await stack.first(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [userId],
  )
  return accessTokenService.sign({ sub: userId, sid: String(session.id) })
}

const createSchedule = (session: AdminSession, userId: string, body: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/sip-schedules`,
    headers: adminHeaders(session, `schedule-${randomUUID()}`),
    payload: body,
  })

const scheduleFor = async (userId: string, startMonth: string, monthCount = 12, fund = fundId): Promise<Schedule> => {
  const response = await createSchedule(finance, userId, { fundId: fund, monthlyAmountPaise: "500000", startMonth, monthCount })
  expect(response.statusCode).toBe(201)
  return envelopeOf<{ schedule: Schedule }>(response).data.schedule
}

const record = (userId: string, link: Link | null, options: { key?: string; fund?: string; reasonCode?: string } = {}) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/recorded-contributions`,
    headers: adminHeaders(finance, options.key ?? `record-${randomUUID()}`),
    payload: {
      fundId: options.fund ?? fundId,
      amountPaise: "500000",
      effectiveDate: EFFECTIVE_DATE,
      reasonCode: options.reasonCode ?? MONTHLY,
      ...(link === null ? {} : { sipScheduleLink: link }),
    },
  })

const recordOk = async (userId: string, link: Link): Promise<string> => {
  const response = await record(userId, link)
  expect(response.statusCode).toBe(201)
  return envelopeOf<{ entryId: string }>(response).data.entryId
}

const adminSchedules = async (userId: string): Promise<Schedule[]> => {
  const response = await app.inject({
    method: "GET",
    url: `/v1/admin/clients/${userId}/sip-schedules`,
    headers: adminHeaders(finance),
  })
  expect(response.statusCode).toBe(200)
  return [...envelopeOf<{ items: Schedule[] }>(response).data.items]
}

const clientSchedules = async (userId: string): Promise<ClientSchedule[]> => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/client/sip-schedules",
    headers: { authorization: `Bearer ${await clientToken(userId)}` },
  })
  expect(response.statusCode).toBe(200)
  return [...envelopeOf<{ items: ClientSchedule[] }>(response).data.items]
}

const expectRefusedField = async (response: { statusCode: number; json: () => unknown }, field: string) => {
  expect(response.statusCode).toBe(400)
  expect(envelopeOf(response).error.code).toBe("VALIDATION_FAILED")
  expect(envelopeOf(response).error.fields?.[field]).toBeDefined()
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
  const sipScheduleRepository = createAdminSipScheduleRepository()
  const shared = {
    webAuth,
    unitOfWork: stack.unitOfWork,
    database: stack.database,
    clock: stack.clock,
    userRepository: stack.userRepository,
    auditRepository: stack.auditRepository,
    idempotencyRepository: createIdempotencyRepository(),
    sipScheduleRepository,
  }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminClientPositionRoutes(instance, {
        ...shared,
        config: { idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" },
        outboxRepository: stack.outboxRepository,
        emailDeliveryRepository: stack.emailDeliveryRepository,
        crypto: stack.crypto,
        clientPositionRepository: createClientPositionRepository(),
        recordingCategoryRepository: createRecordingCategoryRepository(),
        clientGrowthRepository: createClientGrowthRepository(),
        notificationRepository: createNotificationRepository(),
      })
      registerAdminSipScheduleRoutes(instance, { ...shared, config: { idempotencyTtlMs: 86_400_000, cursorKey: randomBytes(32) } })
      const clientDeps = { accessTokenService, database: stack.database, clientWeb: { originAllowlist: [] }, clock: stack.clock }
      registerClientSipScheduleRoutes(instance, { ...clientDeps, sipScheduleRepository })
      registerClientReceiptRoutes(instance, {
        ...clientDeps,
        clientReceiptRepository: createClientReceiptRepository(),
        config: { cursorKey: randomBytes(32) },
      })
    },
  })
  finance = await signInRoleAdmin(app, stack, "finance")
  support = await signInRoleAdmin(app, stack, "support")
  fundId = await seedFund("Monthly Balanced Fund")
  otherFundId = await seedFund("Monthly Equity Fund")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("admin SIP schedule months", () => {
  test("links one recording per month and refuses a second recording for that month without writing anything", async () => {
    const client = await stack.seedUser()
    const schedule = await scheduleFor(client.id, "2025-01")
    const entryId = await recordOk(client.id, { scheduleId: schedule.scheduleId, month: "2025-03" })
    const before = await writeCounts()

    const second = await record(client.id, { scheduleId: schedule.scheduleId, month: "2025-03" })

    await expectRefusedField(second, "sipScheduleLink.month")
    expect(await writeCounts()).toEqual(before)
    const receipt = await app.inject({
      method: "GET",
      url: `/v1/client/receipts/${entryId}`,
      headers: { authorization: `Bearer ${await clientToken(client.id)}` },
    })
    expect(envelopeOf<{ receipt: { sipMonth: string | null } }>(receipt).data.receipt.sipMonth).toBe("2025-03")
    expect((await adminSchedules(client.id))[0]).toMatchObject({ monthsPaid: 1, paidMonths: ["2025-03"] })
  })

  test("a replay with the same key returns the first recording and links the month once", async () => {
    const client = await stack.seedUser()
    const schedule = await scheduleFor(client.id, "2025-01")
    const link = { scheduleId: schedule.scheduleId, month: "2025-02" }
    const key = `replay-${randomUUID()}`

    const first = await record(client.id, link, { key })
    const replay = await record(client.id, link, { key })

    expect(first.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    expect(envelopeOf<{ entryId: string }>(replay).data.entryId).toBe(envelopeOf<{ entryId: string }>(first).data.entryId)
    expect(await stack.count("admin_sip_schedule_months", "schedule_id = $1", [schedule.scheduleId])).toBe(1)
    expect(await stack.count("client_value_entries", "user_id = $1", [client.id])).toBe(1)
  })

  test("refuses another client's schedule, another fund's schedule, a closed schedule and a non-monthly category before writing", async () => {
    const owner = await stack.seedUser()
    const stranger = await stack.seedUser()
    const schedule = await scheduleFor(owner.id, "2025-01")
    const closable = await scheduleFor(owner.id, "2025-01", 12, otherFundId)
    const closed = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${owner.id}/sip-schedules/${closable.scheduleId}/close`,
      headers: adminHeaders(finance, `close-${randomUUID()}`),
      payload: { expectedVersion: closable.version },
    })
    expect(closed.statusCode).toBe(200)
    const before = await writeCounts()
    const link = { scheduleId: schedule.scheduleId, month: "2025-04" }

    await expectRefusedField(await record(stranger.id, link), "sipScheduleLink.scheduleId")
    await expectRefusedField(await record(owner.id, link, { fund: otherFundId }), "sipScheduleLink.scheduleId")
    await expectRefusedField(
      await record(owner.id, { scheduleId: closable.scheduleId, month: "2025-04" }, { fund: otherFundId }),
      "sipScheduleLink.scheduleId",
    )
    await expectRefusedField(await record(owner.id, link, { reasonCode: "recorded_offline_investment" }), "sipScheduleLink")
    await expectRefusedField(await record(owner.id, { ...link, month: "2026-01" }), "sipScheduleLink.month")
    expect(await writeCounts()).toEqual(before)
  })

  test("counts paid months from live links, frees a reversed month for a new recording and keeps linked months in range", async () => {
    const client = await stack.seedUser()
    const current = indiaMonthNow()
    const [m0, m1, m2, m5] = [shiftMonth(current, -2), shiftMonth(current, -1), current, shiftMonth(current, 3)]
    const schedule = await scheduleFor(client.id, m0, 6)
    const first = await recordOk(client.id, { scheduleId: schedule.scheduleId, month: m0 })
    await recordOk(client.id, { scheduleId: schedule.scheduleId, month: m2 })
    await recordOk(client.id, { scheduleId: schedule.scheduleId, month: m5 })
    expect((await adminSchedules(client.id))[0]).toMatchObject({ monthsPaid: 3, monthsDue: 1, nextUnpaidMonth: m1 })

    const reversal = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${client.id}/ledger-entries/${first}/reversal`,
      headers: adminHeaders(finance, `reverse-${randomUUID()}`),
      payload: { reasonCode: "recorded_in_error" },
    })
    expect(reversal.statusCode).toBe(201)
    expect((await adminSchedules(client.id))[0]).toMatchObject({ monthsPaid: 2, monthsDue: 2, nextUnpaidMonth: m0, paidMonths: [m2, m5] })

    await recordOk(client.id, { scheduleId: schedule.scheduleId, month: m0 })
    const [after] = await adminSchedules(client.id)
    expect(after).toMatchObject({ monthsPaid: 3, monthsDue: 1, nextUnpaidMonth: m1, paidMonths: [m0, m2, m5] })
    expect(await clientSchedules(client.id)).toEqual([
      expect.objectContaining({ scheduleId: schedule.scheduleId, monthsPaid: 3, totalMonths: 6, state: "active" }),
    ])

    const edit = (body: Record<string, unknown>) =>
      app.inject({
        method: "PATCH",
        url: `/v1/admin/clients/${client.id}/sip-schedules/${schedule.scheduleId}`,
        headers: adminHeaders(finance, `edit-${randomUUID()}`),
        payload: body,
      })
    await expectRefusedField(await edit({ expectedVersion: after?.version, monthCount: 5 }), "monthCount")
    const grown = await edit({ expectedVersion: after?.version, monthCount: 7, monthlyAmountPaise: "750000" })
    expect(grown.statusCode).toBe(200)
    expect(envelopeOf<{ schedule: Schedule }>(grown).data.schedule).toMatchObject({ monthCount: 7, monthsPaid: 3 })
    const stale = await edit({ expectedVersion: after?.version, monthCount: 8 })
    expect(stale.statusCode).toBe(409)
    expect(envelopeOf(stale).error.code).toBe("STATE_CONFLICT")
  })

  test("two recordings racing for the same month with different keys link it once and refuse the other cleanly", async () => {
    const client = await stack.seedUser()
    const schedule = await scheduleFor(client.id, "2025-01")
    const link = { scheduleId: schedule.scheduleId, month: "2025-05" }

    const responses = await Promise.all([record(client.id, link), record(client.id, link)])

    const statuses = responses.map((response) => response.statusCode).sort()
    expect(statuses).toEqual([201, 400])
    const refused = responses.find((response) => response.statusCode === 400)
    expect(refused === undefined ? null : envelopeOf(refused).error.fields?.["sipScheduleLink.month"]).toBeDefined()
    expect(await stack.count("client_value_entries", "user_id = $1", [client.id])).toBe(1)
    expect(await stack.count("admin_sip_schedule_months", "schedule_id = $1 and released_at is null", [schedule.scheduleId])).toBe(1)
  })

  test("pages a fund's schedules by client name then schedule id without repeating or skipping one", async () => {
    const fund = await seedFund("Paged Monthly Fund")
    const names = ["Zara Khan", "Arjun Rao", "Arjun Rao", "Meera Iyer", "Arjun Rao"]
    const created: string[] = []
    for (const name of names) {
      const client = await stack.seedUser()
      await stack.pool.query("update users set full_name = $2 where id = $1", [client.id, name])
      created.push((await scheduleFor(client.id, "2025-01", 12, fund)).scheduleId)
    }
    const page = (after: string | null, state = "active") =>
      app.inject({
        method: "GET",
        url: `/v1/admin/sip-schedules?fundId=${fund}&state=${state}&limit=2${after === null ? "" : `&after=${encodeURIComponent(after)}`}`,
        headers: adminHeaders(finance),
      })

    const walked: FundSchedule[] = []
    let cursor: string | null = null
    for (let index = 0; index < 5; index += 1) {
      const response = await page(cursor)
      expect(response.statusCode).toBe(200)
      walked.push(...envelopeOf<{ items: FundSchedule[] }>(response).data.items)
      cursor = envelopeOf(response).meta.page?.nextCursor ?? null
      if (cursor === null) break
    }

    const expected = [...walked].sort((left, right) =>
      left.clientName === right.clientName ? (left.scheduleId < right.scheduleId ? -1 : 1) : left.clientName < right.clientName ? -1 : 1,
    )
    expect(walked.map((item) => item.scheduleId)).toEqual(expected.map((item) => item.scheduleId))
    expect(new Set(walked.map((item) => item.scheduleId))).toEqual(new Set(created))
    expect(walked.map((item) => item.clientName)).toEqual(["Arjun Rao", "Arjun Rao", "Arjun Rao", "Meera Iyer", "Zara Khan"])
    const first = envelopeOf((await page(null))).meta.page?.nextCursor ?? ""
    const otherFilter = await page(first, "closed")
    expect(envelopeOf(otherFilter).error.code).toBe("CURSOR_INVALID")
  })

  test("a client sees only their own schedules", async () => {
    const owner = await stack.seedUser()
    const other = await stack.seedUser()
    const schedule = await scheduleFor(owner.id, "2025-01", 24)

    expect(await clientSchedules(other.id)).toEqual([])
    expect(await clientSchedules(owner.id)).toEqual([
      expect.objectContaining({ scheduleId: schedule.scheduleId, fundId, monthlyAmountPaise: "500000", totalMonths: 24, monthsPaid: 0 }),
    ])
  })

  test("refuses reads and writes to an admin without client value permissions and writes nothing", async () => {
    const client = await stack.seedUser()
    const before = await writeCounts()

    const created = await createSchedule(support, client.id, { fundId, monthlyAmountPaise: "500000", startMonth: "2025-01", monthCount: 12 })
    const listed = await app.inject({ method: "GET", url: `/v1/admin/clients/${client.id}/sip-schedules`, headers: adminHeaders(support) })
    const byFund = await app.inject({ method: "GET", url: `/v1/admin/sip-schedules?fundId=${fundId}`, headers: adminHeaders(support) })

    expect([created.statusCode, listed.statusCode, byFund.statusCode]).toEqual([403, 403, 403])
    expect(await writeCounts()).toEqual(before)
  })
})
