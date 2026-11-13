import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccountingReportRepository } from "../../src/repositories/accountingReportRepository.js"
import { createAuditTrailRepository } from "../../src/repositories/auditTrailRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminAuditTrailRoutes } from "../../src/routes/adminAuditTrailRoutes.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerAdminClientPositionRoutes } from "../../src/routes/adminClientPositionRoutes.js"
import { registerAdminReportRoutes } from "../../src/routes/adminReportRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { ADMIN_ORIGIN, adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

interface Balance {
  readonly userId: string
  readonly clientName: string
  readonly clientEmail: string
  readonly fundId: string
  readonly investedPaise: string
  readonly valuePaise: string
}

interface Contribution {
  readonly entryId: string
  readonly userId: string
  readonly categoryLabel: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly recordedAt: string
  readonly reversedAt: string | null
}

interface TrailItem {
  readonly id: string
  readonly command: string
  readonly client: { readonly userId: string; readonly fullName: string } | null
  readonly amountPaise: string | null
  readonly fundId: string | null
  readonly ledgerEntryId: string | null
}

interface Envelope<T> {
  readonly data: T
  readonly meta: { readonly page: { readonly nextCursor: string | null; readonly hasMore: boolean } }
  readonly error: { readonly code: string }
}

interface Fund {
  readonly fundId: string
  readonly versionId: string
}

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let support: AdminSession
let superadmin: AdminSession

const indiaToday = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

const get = (session: AdminSession | null, url: string) =>
  app.inject({ method: "GET", url, headers: session === null ? { origin: ADMIN_ORIGIN } : adminHeaders(session) })

const walk = async <T>(session: AdminSession, url: string, limit: number): Promise<T[]> => {
  const items: T[] = []
  let after: string | null = null
  for (let page = 0; page < 500; page += 1) {
    const separator = url.includes("?") ? "&" : "?"
    const cursor = after === null ? "" : `&after=${encodeURIComponent(after)}`
    const response = await get(session, `${url}${separator}limit=${String(limit)}${cursor}`)
    expect(response.statusCode, response.body).toBe(200)
    const body = envelopeOf<{ items: T[] }>(response)
    items.push(...body.data.items)
    if (!body.meta.page.hasMore) return items
    after = body.meta.page.nextCursor
  }
  throw new Error("paging did not finish")
}

const seedFund = async (): Promise<Fund> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`reports-${randomUUID().slice(0, 8)}`, finance.userId],
  )
  const disclosure = await stack.first(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Disclosure', 'Body.', $2, now(), $3) returning id",
    [fund.id, randomBytes(32), finance.userId],
  )
  const version = await stack.first(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'Reports Fund', 'hybrid', 'Growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4) returning id",
    [fund.id, disclosure.id, randomBytes(32), finance.userId],
  )
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [version.id, fund.id])
  return { fundId: String(fund.id), versionId: String(version.id) }
}

const contribute = async (
  userId: string,
  fund: Fund,
  paise: number,
  effectiveDate: string,
  createdAt: string | null = null,
): Promise<string> => {
  const order = await stack.first(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'lump_sum', 'accepted', $4, now()) returning id",
    [userId, fund.fundId, fund.versionId, paise],
  )
  const payment = await stack.first(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, $3, 'succeeded', now()) returning id",
    [order.id, userId, paise],
  )
  const allocation = await stack.first(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, $5, $6) returning id",
    [order.id, userId, fund.fundId, paise, finance.userId, `req-${randomUUID()}`],
  )
  const entry = await stack.first(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id, created_at) " +
      "values ($1, $2, $3, 'contribution', $4, $4, $5, $6, $7, 'investment_accepted', 'admin', $8, $9, coalesce($10::timestamptz, now())) returning id",
    [userId, fund.fundId, allocation.id, paise, effectiveDate, order.id, payment.id, finance.userId, `req-${randomUUID()}`, createdAt],
  )
  return String(entry.id)
}

const growthBatch = async (scope: "individual" | "collective", effectiveDate: string, totalPaise: number): Promise<string> => {
  const batch = await stack.first(
    "insert into client_growth_batches (scope, instruction_type, effective_date, reason_code, basis_hash, actor_user_id, " +
      "request_id, target_count, total_delta_paise) values ($1, 'explicit_deltas', $2, 'monthly', 'hash', $3, $4, 1, $5) returning id",
    [scope, effectiveDate, finance.userId, `req-${randomUUID()}`, totalPaise],
  )
  return String(batch.id)
}

const grow = async (userId: string, fundId: string, paise: number, effectiveDate: string, batchId?: string): Promise<void> => {
  const batch = batchId ?? (await growthBatch("individual", effectiveDate, paise))
  await stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "growth_batch_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'growth_adjustment', 0, $3, $4, $5, 'monthly', 'admin', $6, $7)",
    [userId, fundId, paise, effectiveDate, batch, finance.userId, `req-${randomUUID()}`],
  )
}

const reverseDirectly = async (entryId: string): Promise<void> => {
  await stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "reverses_entry_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "select user_id, fund_id, 'reversal', -principal_delta_paise, -value_delta_paise, effective_date, id, " +
      "'admin_correction_reversal', 'admin', $2, $3 from client_value_entries where id = $1",
    [entryId, finance.userId, `req-${randomUUID()}`],
  )
}

const record = async (userId: string, fund: Fund, amountPaise: string, effectiveDate: string, reasonCode: string): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/recorded-contributions`,
    headers: adminHeaders(finance, `record-${randomUUID()}`),
    payload: { fundId: fund.fundId, amountPaise, effectiveDate, reasonCode },
  })
  expect(response.statusCode, response.body).toBe(201)
  return envelopeOf<{ entryId: string }>(response).data.entryId
}

const reverse = async (userId: string, entryId: string): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/ledger-entries/${entryId}/reversal`,
    headers: adminHeaders(finance, `reverse-${randomUUID()}`),
    payload: { reasonCode: "admin_correction_reversal" },
  })
  expect(response.statusCode, response.body).toBe(201)
  return envelopeOf<{ entryId: string }>(response).data.entryId
}

const balancesOf = async (asOfDate: string, userIds: readonly string[]): Promise<Record<string, { invested: string; value: string }>> => {
  const rows = await walk<Balance>(finance, `/v1/admin/reports/client-balances?asOfDate=${asOfDate}`, 1)
  return Object.fromEntries(
    rows
      .filter((row) => userIds.includes(row.userId))
      .map((row) => [`${row.userId}/${row.fundId}`, { invested: row.investedPaise, value: row.valuePaise }]),
  )
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  const readDeps = { webAuth, database: stack.database, clock: stack.clock, config: { cursorKey: randomBytes(32) } }
  const writeDeps = {
    webAuth,
    unitOfWork: stack.unitOfWork,
    database: stack.database,
    clock: stack.clock,
    clientGrowthRepository: createClientGrowthRepository(),
    auditRepository: stack.auditRepository,
    idempotencyRepository: createIdempotencyRepository(),
    notificationRepository: createNotificationRepository(),
  }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminClientGrowthRoutes(instance, { ...writeDeps, config: { idempotencyTtlMs: 86_400_000 } })
      registerAdminClientPositionRoutes(instance, {
        ...writeDeps,
        config: { idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" },
        outboxRepository: stack.outboxRepository,
        emailDeliveryRepository: stack.emailDeliveryRepository,
        crypto: stack.crypto,
        clientPositionRepository: createClientPositionRepository(),
        userRepository: stack.userRepository,
      })
      registerAdminReportRoutes(instance, { ...readDeps, accountingReportRepository: createAccountingReportRepository() })
      registerAdminAuditTrailRoutes(instance, { ...readDeps, auditTrailRepository: createAuditTrailRepository() })
    },
  })
  finance = await signInRoleAdmin(app, stack, "finance")
  support = await signInRoleAdmin(app, stack, "support")
  superadmin = await signInRoleAdmin(app, stack, "superadmin")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("accounting exports", () => {
  test("balances count only entries effective on or before the IST date, net a reversed pair and match today's positions", async () => {
    const fund = await seedFund()
    const otherFund = await seedFund()
    const first = (await stack.seedUser()).id
    const second = (await stack.seedUser()).id
    await contribute(first, fund, 100_000, "2025-03-10")
    await reverseDirectly(await contribute(first, fund, 50_000, "2025-04-05"))
    await grow(first, fund.fundId, 7_000, "2025-05-31")
    await contribute(first, fund, 25_000, "2025-06-01")
    await contribute(first, otherFund, 30_000, "2025-06-15")
    await contribute(second, fund, 40_000, "2025-05-31")
    await grow(second, fund.fundId, -1_000, "2025-06-02")
    const users = [first, second]

    expect(await balancesOf("2025-03-09", users)).toEqual({})
    expect(await balancesOf("2025-04-04", users)).toEqual({ [`${first}/${fund.fundId}`]: { invested: "100000", value: "100000" } })
    expect(await balancesOf("2025-04-05", users)).toEqual({ [`${first}/${fund.fundId}`]: { invested: "100000", value: "100000" } })
    expect(await balancesOf("2025-05-31", users)).toEqual({
      [`${first}/${fund.fundId}`]: { invested: "100000", value: "107000" },
      [`${second}/${fund.fundId}`]: { invested: "40000", value: "40000" },
    })
    expect(await balancesOf("2025-06-30", users)).toEqual({
      [`${first}/${fund.fundId}`]: { invested: "125000", value: "132000" },
      [`${first}/${otherFund.fundId}`]: { invested: "30000", value: "30000" },
      [`${second}/${fund.fundId}`]: { invested: "40000", value: "39000" },
    })

    const today = await balancesOf(indiaToday(), users)
    const positions: Record<string, { invested: string; value: string }> = {}
    for (const userId of users) {
      const response = await get(finance, `/v1/admin/client-growth/investors/${userId}/positions`)
      expect(response.statusCode, response.body).toBe(200)
      for (const item of envelopeOf<{ items: { fundId: string; principalPaise: string; currentValuePaise: string }[] }>(response).data.items) {
        positions[`${userId}/${item.fundId}`] = { invested: item.principalPaise, value: item.currentValuePaise }
      }
    }
    expect(today).toEqual(positions)
  })

  test("contributions by month keep the IST effective-date boundaries, label categories and flag reversals", async () => {
    const fund = await seedFund()
    const client = (await stack.seedUser()).id
    await record(client, fund, "11000", "2025-07-31", "recorded_offline_monthly_investment")
    const monthly = await record(client, fund, "12000", "2025-08-01", "recorded_offline_monthly_investment")
    const earlier = await record(client, fund, "13000", "2025-08-31", "recorded_offline_investment")
    await record(client, fund, "14000", "2025-09-01", "recorded_offline_investment")
    const lateNight = await contribute(client, fund, 15_000, "2025-08-31", "2025-08-31T18:45:00.000Z")
    await contribute(client, fund, 16_000, "2025-09-01", "2025-08-31T18:15:00.000Z")
    await reverse(client, monthly)

    const rows = (await walk<Contribution>(finance, "/v1/admin/reports/contributions?month=2025-08", 2)).filter(
      (row) => row.userId === client,
    )

    expect(
      rows
        .map(({ entryId, categoryLabel, amountPaise, effectiveDate, reversedAt }) => ({
          entryId,
          categoryLabel,
          amountPaise,
          effectiveDate,
          reversed: reversedAt !== null,
        }))
        .sort((left, right) => left.amountPaise.localeCompare(right.amountPaise)),
    ).toEqual([
      { entryId: monthly, categoryLabel: "Monthly investment", amountPaise: "12000", effectiveDate: "2025-08-01", reversed: true },
      { entryId: earlier, categoryLabel: "Earlier investment", amountPaise: "13000", effectiveDate: "2025-08-31", reversed: false },
      { entryId: lateNight, categoryLabel: "One-off investment", amountPaise: "15000", effectiveDate: "2025-08-31", reversed: false },
    ])
    expect(rows.find((row) => row.entryId === lateNight)?.recordedAt).toBe("2025-08-31T18:45:00.000Z")
  })

  test("pages return every row exactly once when rows share a millisecond", async () => {
    const fund = await seedFund()
    const client = (await stack.seedUser()).id
    const entries: string[] = []
    for (let index = 1; index <= 5; index += 1) {
      entries.push(await contribute(client, fund, 1_000 * index, "2025-10-10", `2025-10-10T04:30:00.00000${String(index)}Z`))
    }
    const contributions = (await walk<Contribution>(finance, "/v1/admin/reports/contributions?month=2025-10", 2)).filter(
      (row) => row.userId === client,
    )
    expect(contributions.map((row) => row.entryId).sort()).toEqual([...entries].sort())

    const events: string[] = []
    for (let index = 1; index <= 5; index += 1) {
      const event = await stack.first(
        "insert into audit_events (occurred_at, actor_type, actor_user_id, command, entity_type, entity_id, request_id, entity_version) " +
          "values ($1, 'admin', $2, 'user.suspended', 'user', $3, $4, 1) returning id",
        [`2025-10-10T04:30:00.00000${String(index)}Z`, superadmin.userId, client, randomUUID()],
      )
      events.push(String(event.id))
    }
    const trail = await walk<TrailItem>(superadmin, `/v1/admin/users/${client}/audit-events`, 2)
    expect(trail.map((item) => item.id).sort()).toEqual([...events].sort())
  })
})

describe("admin audit trail", () => {
  test("presets show money commands with client and amount, and a client's list holds only its own events", async () => {
    const fund = await seedFund()
    const client = (await stack.seedUser()).id
    const other = (await stack.seedUser()).id
    const kept = await record(client, fund, "20000", "2025-05-01", "recorded_offline_investment")
    const mistaken = await record(client, fund, "12345", "2025-05-02", "recorded_offline_investment")
    const reversal = await reverse(client, mistaken)
    const otherEntry = await record(other, fund, "30000", "2025-05-01", "recorded_offline_investment")
    const batch = await growthBatch("collective", "2025-05-31", 1_200)
    await grow(client, fund.fundId, 500, "2025-05-31", batch)
    await grow(other, fund.fundId, 700, "2025-05-31", batch)
    await stack.pool.query(
      "insert into audit_events (actor_type, actor_user_id, command, entity_type, entity_id, request_id, entity_version, metadata) " +
        "values ('admin', $1, 'client_growth.collective', 'client_growth_batch', $2, $3, 1, $4)",
      [finance.userId, batch, randomUUID(), JSON.stringify({ fundId: fund.fundId, scope: "collective", totalDeltaPaise: "1200" })],
    )
    const range = `fromDate=${indiaToday()}&toDate=${indiaToday()}`
    const shape = (item: TrailItem) => ({
      command: item.command,
      clientId: item.client?.userId ?? null,
      amountPaise: item.amountPaise,
      ledgerEntryId: item.ledgerEntryId,
    })

    const recordings = await walk<TrailItem>(superadmin, `/v1/admin/audit-events?preset=recordings&${range}`, 100)
    expect(recordings.every((item) => item.command === "client_position.contribution_recorded")).toBe(true)
    expect(recordings.filter((item) => item.client?.userId === client).map(shape)).toEqual([
      { command: "client_position.contribution_recorded", clientId: client, amountPaise: "12345", ledgerEntryId: mistaken },
      { command: "client_position.contribution_recorded", clientId: client, amountPaise: "20000", ledgerEntryId: kept },
    ])
    expect(recordings.find((item) => item.ledgerEntryId === kept)?.client?.fullName).toBe("Ada Lovelace")

    const reversals = await walk<TrailItem>(superadmin, `/v1/admin/audit-events?preset=reversals&${range}`, 100)
    expect(reversals.filter((item) => item.client?.userId === client).map(shape)).toEqual([
      { command: "client_position.entry_reversed", clientId: client, amountPaise: "-12345", ledgerEntryId: reversal },
    ])

    const growth = await walk<TrailItem>(superadmin, `/v1/admin/audit-events?preset=growth&${range}`, 100)
    expect(growth.filter((item) => item.fundId === fund.fundId).map(shape)).toEqual([
      { command: "client_growth.collective", clientId: null, amountPaise: "1200", ledgerEntryId: null },
    ])

    const own = (await walk<TrailItem>(superadmin, `/v1/admin/users/${client}/audit-events`, 2)).filter((item) =>
      item.command.startsWith("client_"),
    )
    expect(own.map(shape)).toEqual([
      expect.objectContaining({ command: "client_growth.collective", clientId: client, amountPaise: "500" }),
      { command: "client_position.entry_reversed", clientId: client, amountPaise: "-12345", ledgerEntryId: reversal },
      { command: "client_position.contribution_recorded", clientId: client, amountPaise: "12345", ledgerEntryId: mistaken },
      { command: "client_position.contribution_recorded", clientId: client, amountPaise: "20000", ledgerEntryId: kept },
    ])
    const otherOwn = await walk<TrailItem>(superadmin, `/v1/admin/users/${other}/audit-events`, 100)
    expect(otherOwn.some((item) => item.ledgerEntryId === kept || item.ledgerEntryId === mistaken)).toBe(false)
    expect(otherOwn.filter((item) => item.command.startsWith("client_")).map(shape)).toEqual([
      expect.objectContaining({ command: "client_growth.collective", clientId: other, amountPaise: "700" }),
      { command: "client_position.contribution_recorded", clientId: other, amountPaise: "30000", ledgerEntryId: otherEntry },
    ])

    expect((await get(superadmin, `/v1/admin/users/${randomUUID()}/audit-events`)).statusCode).toBe(404)
    const backwards = await get(superadmin, "/v1/admin/audit-events?fromDate=2025-05-02&toDate=2025-05-01")
    expect(backwards.statusCode).toBe(400)
  })

  test("exports need client_values.read and audit lists need audit.read", async () => {
    const client = (await stack.seedUser()).id
    const reports = ["/v1/admin/reports/client-balances?asOfDate=2025-01-01", "/v1/admin/reports/contributions?month=2025-01"]
    const audits = ["/v1/admin/audit-events", `/v1/admin/users/${client}/audit-events`]

    for (const url of [...reports, ...audits]) {
      const anonymous = await get(null, url)
      expect(anonymous.statusCode, url).toBe(401)
      const denied = await get(support, url)
      expect(denied.statusCode, url).toBe(403)
      expect(envelopeOf(denied).error.code).toBe("AUTHORIZATION_DENIED")
    }
    for (const url of reports) expect((await get(finance, url)).statusCode, url).toBe(200)
    for (const url of audits) {
      expect((await get(finance, url)).statusCode, url).toBe(403)
      expect((await get(superadmin, url)).statusCode, url).toBe(200)
    }
  })
})
