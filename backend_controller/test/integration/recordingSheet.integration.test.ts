import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createMonthlyRecordingSheetRepository } from "../../src/repositories/monthlyRecordingSheetRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminClientPositionRoutes } from "../../src/routes/adminClientPositionRoutes.js"
import { registerAdminRecordingSheetRoutes } from "../../src/routes/adminRecordingSheetRoutes.js"
import { registerAdminSipScheduleRoutes } from "../../src/routes/adminSipScheduleRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { ADMIN_ORIGIN, adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

interface Envelope<T> {
  readonly data: T
  readonly meta: { readonly page?: { readonly nextCursor: string | null; readonly hasMore: boolean } }
  readonly error: { readonly code: string; readonly fields?: Record<string, readonly string[]> }
}

interface SheetRow {
  readonly scheduleId: string
  readonly userId: string
  readonly clientName: string
  readonly clientEmail: string
  readonly fundId: string
  readonly fundName: string
  readonly monthlyAmountPaise: string
  readonly startMonth: string
  readonly monthCount: number
  readonly recorded: { readonly entryId: string; readonly amountPaise: string; readonly effectiveDate: string } | null
}

interface Schedule {
  readonly scheduleId: string
  readonly version: number
}

const MONTH = "2025-03"
const EFFECTIVE_DATE = "2025-03-05"

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let support: AdminSession
let fundId: string
let otherFundId: string

const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

const seedFund = async (name: string): Promise<string> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`sheet-${randomUUID().slice(0, 8)}`, finance.userId],
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

const namedClient = async (name: string): Promise<string> => {
  const client = await stack.seedUser()
  await stack.pool.query("update users set full_name = $2 where id = $1", [client.id, name])
  return client.id
}

const scheduleFor = async (userId: string, startMonth: string, monthCount: number, fund = fundId): Promise<Schedule> => {
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/sip-schedules`,
    headers: adminHeaders(finance, `schedule-${randomUUID()}`),
    payload: { fundId: fund, monthlyAmountPaise: "500000", startMonth, monthCount },
  })
  expect(response.statusCode).toBe(201)
  return envelopeOf<{ schedule: Schedule }>(response).data.schedule
}

const recordMonth = async (userId: string, scheduleId: string, amountPaise: string, fund = fundId): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/recorded-contributions`,
    headers: adminHeaders(finance, `record-${randomUUID()}`),
    payload: {
      fundId: fund,
      amountPaise,
      effectiveDate: EFFECTIVE_DATE,
      reasonCode: "recorded_offline_monthly_investment",
      sipScheduleLink: { scheduleId, month: MONTH },
    },
  })
  expect(response.statusCode).toBe(201)
  return envelopeOf<{ entryId: string }>(response).data.entryId
}

const sheet = (query: string, session: AdminSession = finance) =>
  app.inject({ method: "GET", url: `/v1/admin/recording-sheet?${query}`, headers: adminHeaders(session) })

const walkSheet = async (query: string, limit: number): Promise<SheetRow[]> => {
  const rows: SheetRow[] = []
  let cursor: string | null = null
  for (let index = 0; index < 50; index += 1) {
    const response = await sheet(`${query}&limit=${String(limit)}${cursor === null ? "" : `&after=${encodeURIComponent(cursor)}`}`)
    expect(response.statusCode).toBe(200)
    rows.push(...envelopeOf<{ items: SheetRow[] }>(response).data.items)
    cursor = envelopeOf(response).meta.page?.nextCursor ?? null
    if (cursor === null) return rows
  }
  throw new Error("the sheet walk did not end")
}

const rowsFor = async (query: string, userIds: readonly string[]): Promise<SheetRow[]> =>
  (await walkSheet(query, 100)).filter((row) => userIds.includes(row.userId))

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  const shared = {
    webAuth,
    unitOfWork: stack.unitOfWork,
    database: stack.database,
    clock: stack.clock,
    userRepository: stack.userRepository,
    auditRepository: stack.auditRepository,
    idempotencyRepository: createIdempotencyRepository(),
    sipScheduleRepository: createAdminSipScheduleRepository(),
  }
  const cursorKey = randomBytes(32)
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
        clientGrowthRepository: createClientGrowthRepository(),
        notificationRepository: createNotificationRepository(),
      })
      registerAdminSipScheduleRoutes(instance, { ...shared, config: { idempotencyTtlMs: 86_400_000, cursorKey } })
      registerAdminRecordingSheetRoutes(instance, {
        webAuth,
        database: stack.database,
        clock: stack.clock,
        config: { cursorKey },
        recordingSheetRepository: createMonthlyRecordingSheetRepository(),
      })
    },
  })
  finance = await signInRoleAdmin(app, stack, "finance")
  support = await signInRoleAdmin(app, stack, "support")
  fundId = await seedFund("Sheet Balanced Fund")
  otherFundId = await seedFund("Sheet Equity Fund")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("admin monthly recording sheet", () => {
  test("lists only active schedules whose range covers the month, across funds, with that month's recorded amount", async () => {
    const asha = await namedClient("Asha Rao")
    const bala = await namedClient("Bala Iyer")
    const chitra = await namedClient("Chitra Nair")
    const dev = await namedClient("Dev Shah")
    const esha = await namedClient("Esha Menon")
    const paid = await scheduleFor(asha, "2025-01", 12)
    const unpaid = await scheduleFor(asha, "2025-03", 6, otherFundId)
    await scheduleFor(bala, "2025-04", 12)
    const lastMonth = await scheduleFor(chitra, "2024-04", 12)
    await scheduleFor(dev, "2024-03", 12)
    const closed = await scheduleFor(esha, "2025-01", 12)
    const entryId = await recordMonth(asha, paid.scheduleId, "450075")
    const closing = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${esha}/sip-schedules/${closed.scheduleId}/close`,
      headers: adminHeaders(finance, `close-${randomUUID()}`),
      payload: { expectedVersion: closed.version },
    })
    expect(closing.statusCode).toBe(200)

    const rows = await rowsFor(`month=${MONTH}`, [asha, bala, chitra, dev, esha])

    expect(rows.map((row) => row.scheduleId).sort()).toEqual(
      [paid.scheduleId, unpaid.scheduleId, lastMonth.scheduleId].sort(),
    )
    expect(rows.find((row) => row.scheduleId === paid.scheduleId)).toMatchObject({
      userId: asha,
      clientName: "Asha Rao",
      fundId,
      fundName: "Sheet Balanced Fund",
      monthlyAmountPaise: "500000",
      startMonth: "2025-01",
      monthCount: 12,
      recorded: { entryId, amountPaise: "450075", effectiveDate: EFFECTIVE_DATE },
    })
    expect(rows.find((row) => row.scheduleId === unpaid.scheduleId)?.recorded).toBeNull()
    expect(rows.find((row) => row.scheduleId === lastMonth.scheduleId)?.recorded).toBeNull()

    const otherFund = await rowsFor(`month=${MONTH}&fundId=${otherFundId}`, [asha, bala, chitra, dev, esha])
    expect(otherFund.map((row) => row.scheduleId)).toEqual([unpaid.scheduleId])
    const nextMonth = await rowsFor("month=2025-04", [asha])
    expect(nextMonth.find((row) => row.scheduleId === paid.scheduleId)?.recorded).toBeNull()
  })

  test("a reversed recording stops counting for its month, and the next recording is the one shown", async () => {
    const client = await namedClient("Farah Ali")
    const schedule = await scheduleFor(client, "2025-01", 12)
    const first = await recordMonth(client, schedule.scheduleId, "500000")

    const reversal = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${client}/ledger-entries/${first}/reversal`,
      headers: adminHeaders(finance, `reverse-${randomUUID()}`),
      payload: { reasonCode: "recorded_in_error" },
    })
    expect(reversal.statusCode).toBe(201)
    expect((await rowsFor(`month=${MONTH}`, [client]))[0]?.recorded).toBeNull()

    const second = await recordMonth(client, schedule.scheduleId, "510000")
    expect((await rowsFor(`month=${MONTH}`, [client]))[0]?.recorded).toMatchObject({ entryId: second, amountPaise: "510000" })
  })

  test("pages by client name then schedule id without repeating or skipping a row, and binds the cursor to the filters", async () => {
    const fund = await seedFund("Sheet Paged Fund")
    const created: string[] = []
    for (const name of ["Zara Khan", "Arjun Rao", "Arjun Rao", "Meera Iyer", "Arjun Rao"]) {
      created.push((await scheduleFor(await namedClient(name), "2025-01", 12, fund)).scheduleId)
    }

    const walked = await walkSheet(`month=${MONTH}&fundId=${fund}`, 2)

    expect(new Set(walked.map((row) => row.scheduleId))).toEqual(new Set(created))
    expect(walked).toHaveLength(created.length)
    expect(walked.map((row) => row.clientName)).toEqual(["Arjun Rao", "Arjun Rao", "Arjun Rao", "Meera Iyer", "Zara Khan"])
    const arjun = walked.slice(0, 3).map((row) => row.scheduleId)
    expect(arjun).toEqual([...arjun].sort())
    const firstPage = await sheet(`month=${MONTH}&fundId=${fund}&limit=2`)
    const cursor = encodeURIComponent(envelopeOf(firstPage).meta.page?.nextCursor ?? "")
    const otherMonth = await sheet(`month=2025-04&fundId=${fund}&limit=2&after=${cursor}`)
    expect(envelopeOf(otherMonth).error.code).toBe("CURSOR_INVALID")
    const otherFund = await sheet(`month=${MONTH}&limit=2&after=${cursor}`)
    expect(envelopeOf(otherFund).error.code).toBe("CURSOR_INVALID")
  })

  test("refuses an admin without client value permissions, a signed-out caller and a malformed month", async () => {
    const denied = await sheet(`month=${MONTH}`, support)
    const signedOut = await app.inject({
      method: "GET",
      url: `/v1/admin/recording-sheet?month=${MONTH}`,
      headers: { origin: ADMIN_ORIGIN },
    })
    const badMonth = await sheet("month=2025-13")

    expect(denied.statusCode).toBe(403)
    expect(envelopeOf(denied).error.code).toBe("AUTHORIZATION_DENIED")
    expect(signedOut.statusCode).toBe(401)
    expect(badMonth.statusCode).toBe(400)
    expect(envelopeOf(badMonth).error.fields?.month).toBeDefined()
  })
})
