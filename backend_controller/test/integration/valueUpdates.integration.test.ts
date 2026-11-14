import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import { hashPassword } from "../../src/auth/passwordHasher.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientInvestedFundRepository } from "../../src/repositories/clientInvestedFundRepository.js"
import { createClientValueUpdateRepository } from "../../src/repositories/clientValueUpdateRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerClientInvestedFundRoutes } from "../../src/routes/clientInvestedFundRoutes.js"
import { registerClientValueUpdateRoutes } from "../../src/routes/clientValueUpdateRoutes.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"
const FUND_POSITIONS = (fundId: string): string => `/v1/admin/client-growth/funds/${fundId}/positions`

interface Session {
  readonly cookie: string
  readonly csrf: string
}

interface Position {
  readonly userId: string
  readonly fullName: string
  readonly accountState: string
  readonly investedPaise: string
  readonly currentValuePaise: string
  readonly gainPaise: string
}

interface ValueUpdate {
  readonly entryId: string
  readonly fundId: string
  readonly fundName: string
  readonly date: string
  readonly changePaise: string
  readonly valueAfterPaise: string
}

interface Client {
  readonly userId: string
  readonly token: string
}

interface InvestedFund {
  readonly fundId: string
  readonly fundName: string
  readonly fundPublished: boolean
}

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let accessTokenService: AccessTokenService
let finance: Session
let financeId: string

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const pageOf = (response: { json: () => unknown }): { nextCursor: string | null; hasMore: boolean } =>
  (response.json() as { meta: { page: { nextCursor: string | null; hasMore: boolean } } }).meta.page
const randomPhone = (): string => `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`
const pause = async (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

const insertUser = async (fullName: string): Promise<string> => {
  const row = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, $3, 'active', now()) returning id",
    [`vu-${randomUUID().slice(0, 8)}@example.com`, randomPhone(), fullName],
  )
  return row.rows[0]!.id
}

const createAdmin = async (roleCode: string): Promise<{ id: string; session: Session }> => {
  const id = await insertUser("Admin User")
  const email = (await pool.query<{ e: string }>("select email_normalized as e from users where id = $1", [id])).rows[0]!.e
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [id, await hashPassword(PASSWORD)])
  for (const permission of SEED_ROLE_PERMISSIONS[roleCode] ?? []) {
    await pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) " +
        "select r.id, p.id, $1 from roles r, permissions p where r.code = $2 and p.code = $3 on conflict do nothing",
      [id, roleCode, permission],
    )
  }
  await pool.query(
    "insert into user_roles (user_id, role_id, granted_by_user_id) select $1, id, $1 from roles where code = $2",
    [id, roleCode],
  )
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/web/login",
    headers: { origin: ORIGIN },
    payload: { email, password: PASSWORD },
  })
  expect(login.statusCode).toBe(200)
  const setCookie = login.headers["set-cookie"]
  const cookies = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  return {
    id,
    session: {
      cookie: cookies.map((cookie) => cookie.split(";")[0] ?? "").join("; "),
      csrf: dataOf<{ csrfToken: string }>(login).csrfToken,
    },
  }
}

const seedClient = async (fullName: string): Promise<Client> => {
  const userId = await insertUser(fullName)
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [userId],
  )
  return { userId, token: await accessTokenService.sign({ sub: userId, sid: session.rows[0]!.id }) }
}

const seedFund = async (slug: string): Promise<{ fundId: string; versionId: string }> => {
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [slug, financeId],
  )
  const fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), financeId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
      "minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, $2, 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $3, $4, $5) returning id",
    [fundId, `Fund ${slug}`, disclosure.rows[0]!.id, randomBytes(32), financeId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, fundId])
  return { fundId, versionId: version.rows[0]!.id }
}

const seedContribution = async (
  userId: string,
  fund: { fundId: string; versionId: string },
  amountPaise: number,
): Promise<void> => {
  const order = await pool.query<{ id: string }>(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'lump_sum', 'accepted', $4, now()) returning id",
    [userId, fund.fundId, fund.versionId, amountPaise],
  )
  const payment = await pool.query<{ id: string }>(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, $3, 'succeeded', now()) returning id",
    [order.rows[0]!.id, userId, amountPaise],
  )
  const allocation = await pool.query<{ id: string }>(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, $5, $6) returning id",
    [order.rows[0]!.id, userId, fund.fundId, amountPaise, financeId, `req-${randomUUID()}`],
  )
  await pool.query(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', $4, $4, '2026-09-01', $5, $6, 'investment_accepted', 'admin', $7, $8)",
    [userId, fund.fundId, allocation.rows[0]!.id, amountPaise, order.rows[0]!.id, payment.rows[0]!.id, financeId, `req-${randomUUID()}`],
  )
}

const adminHeaders = (session: Session, key?: string): Record<string, string> => ({
  origin: ORIGIN,
  cookie: session.cookie,
  "x-csrf-token": session.csrf,
  ...(key === undefined ? {} : { "idempotency-key": key }),
})

const individualGrowth = async (userId: string, fundId: string, growthPaise: string): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/client-growth/individual",
    headers: adminHeaders(finance, `vu-ind-${randomUUID()}`),
    payload: { userId, fundId, growthPaise, effectiveDate: "2026-09-30", reasonCode: "monthly" },
  })
  expect(response.statusCode).toBe(201)
  return dataOf<{ entryId: string }>(response).entryId
}

const fundPositions = async (fundId: string, session: Session = finance) =>
  app.inject({ method: "GET", url: FUND_POSITIONS(fundId), headers: adminHeaders(session) })

const gainsOf = async (fundId: string): Promise<Record<string, string>> => {
  const response = await fundPositions(fundId)
  expect(response.statusCode).toBe(200)
  return Object.fromEntries(
    dataOf<{ items: Position[] }>(response).items.map((item) => [item.fullName, item.gainPaise]),
  )
}

const preview = async (fundId: string, items: readonly { userId: string; growthPaise: string }[]): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/client-growth/collective/preview",
    headers: adminHeaders(finance),
    payload: { fundId, items },
  })
  expect(response.statusCode).toBe(200)
  return dataOf<{ basisHash: string }>(response).basisHash
}

const commit = async (key: string, payload: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: "/v1/admin/client-growth/collective",
    headers: adminHeaders(finance, key),
    payload: { effectiveDate: "2026-10-31", reasonCode: "monthly", ...payload },
  })

const countOf = async (table: string): Promise<number> =>
  Number((await pool.query<{ n: string }>(`select count(*)::text as n from ${table}`)).rows[0]!.n)

const writeCounts = async (): Promise<readonly number[]> =>
  Promise.all(
    ["client_growth_batches", "client_value_entries", "notifications", "idempotency_records", "audit_events"].map(countOf),
  )

const valueUpdates = async (client: Client, query = "") =>
  app.inject({
    method: "GET",
    url: `/v1/client/value-updates${query}`,
    headers: { authorization: `Bearer ${client.token}` },
  })

const clientGet = async (client: Client, url: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${client.token}` } })

const fundNameOf = async (versionId: string): Promise<string> =>
  (await pool.query<{ name: string }>("select name from fund_versions where id = $1", [versionId])).rows[0]!.name

interface Sheet {
  readonly fund: { fundId: string; versionId: string }
  readonly asha: Client
  readonly bala: Client
  readonly chitra: Client
  readonly dev: Client
}

const seedSheet = async (): Promise<Sheet> => {
  const fund = await seedFund(`vu-${randomUUID().slice(0, 8)}`)
  const asha = await seedClient("Asha Rao")
  const bala = await seedClient("Bala Iyer")
  const chitra = await seedClient("Chitra Nair")
  const dev = await seedClient("Dev Shah")
  await seedContribution(asha.userId, fund, 1_000_000)
  await seedContribution(bala.userId, fund, 250_000)
  await seedContribution(chitra.userId, fund, 500_000)
  await seedContribution(dev.userId, fund, 300_000)
  await pause()
  await individualGrowth(asha.userId, fund.fundId, "52525")
  await individualGrowth(bala.userId, fund.fundId, "-10001")
  await individualGrowth(chitra.userId, fund.fundId, "-500000")
  return { fund, asha, bala, chitra, dev }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 5, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  await runMigrations(pool, await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url))))
  await runSeed(pool)

  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-web",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
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
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerWebAuthRoutes(instance, { ...webAuth, unitOfWork, loginEventRepository: createLoginEventRepository() })
      registerAdminClientGrowthRoutes(instance, {
        webAuth,
        unitOfWork,
        database,
        clock: () => new Date(),
        config: { idempotencyTtlMs: 86_400_000 },
        clientGrowthRepository: createClientGrowthRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
        notificationRepository: createNotificationRepository(),
      })
      registerClientValueUpdateRoutes(instance, {
        accessTokenService,
        database,
        clientWeb: { originAllowlist: [] },
        clientValueUpdateRepository: createClientValueUpdateRepository(),
        clock: () => new Date(),
        config: { cursorKey: randomBytes(32) },
      })
      registerClientInvestedFundRoutes(instance, {
        accessTokenService,
        database,
        clientWeb: { originAllowlist: [] },
        clientInvestedFundRepository: createClientInvestedFundRepository(),
      })
    },
  })
  const financeAdmin = await createAdmin("finance")
  financeId = financeAdmin.id
  finance = financeAdmin.session
}, 220_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("monthly value-update sheet", () => {
  test("lists each client's invested, current value and gain, and lands each typed gain exactly", async () => {
    const sheet = await seedSheet()
    await pool.query("update users set account_state = 'closed', closed_at = now() where id = $1", [sheet.chitra.userId])

    const before = await fundPositions(sheet.fund.fundId)
    expect(before.statusCode).toBe(200)
    expect(dataOf<{ items: Position[] }>(before).items).toEqual([
      { userId: sheet.asha.userId, fullName: "Asha Rao", accountState: "active", investedPaise: "1000000", currentValuePaise: "1052525", gainPaise: "52525" },
      { userId: sheet.bala.userId, fullName: "Bala Iyer", accountState: "active", investedPaise: "250000", currentValuePaise: "239999", gainPaise: "-10001" },
      { userId: sheet.chitra.userId, fullName: "Chitra Nair", accountState: "closed", investedPaise: "500000", currentValuePaise: "0", gainPaise: "-500000" },
      { userId: sheet.dev.userId, fullName: "Dev Shah", accountState: "active", investedPaise: "300000", currentValuePaise: "300000", gainPaise: "0" },
    ])

    const items = [
      { userId: sheet.asha.userId, growthPaise: "70925" },
      { userId: sheet.bala.userId, growthPaise: "-15074" },
    ]
    const basisHash = await preview(sheet.fund.fundId, items)
    const response = await commit(`vu-sheet-${randomUUID()}`, { fundId: sheet.fund.fundId, items, basisHash })
    expect(response.statusCode).toBe(201)
    const batch = dataOf<{ batchId: string; targetCount: number; totalDeltaPaise: string }>(response)
    expect(batch.targetCount).toBe(2)
    expect(batch.totalDeltaPaise).toBe("55851")

    expect(await gainsOf(sheet.fund.fundId)).toEqual({
      "Asha Rao": "123450",
      "Bala Iyer": "-25075",
      "Chitra Nair": "-500000",
      "Dev Shah": "0",
    })

    const notices = await pool.query<{ user_id: string; body: string; payload: Record<string, unknown>; entry_id: string }>(
      "select n.user_id, n.body, n.payload, e.id as entry_id from notifications n " +
        "join client_value_entries e on e.growth_batch_id = $1 and e.user_id = n.user_id " +
        "where n.kind = 'client_value_updated' and n.payload->>'entryId' = e.id::text",
      [batch.batchId],
    )
    expect(notices.rows.map((row) => row.user_id).sort()).toEqual([sheet.asha.userId, sheet.bala.userId].sort())
    for (const notice of notices.rows) {
      expect(notice.payload).toEqual({ fundId: sheet.fund.fundId, entryId: notice.entry_id, deepLink: "/portfolio" })
      expect(notice.body).not.toMatch(/[0-9]/u)
    }
  })

  test("one bad row refuses the whole batch and writes nothing", async () => {
    const sheet = await seedSheet()
    const valid = [{ userId: sheet.asha.userId, growthPaise: "1000" }]
    const basisHash = await preview(sheet.fund.fundId, valid)
    const counts = await writeCounts()

    const belowZero = await commit(`vu-bad-${randomUUID()}`, {
      fundId: sheet.fund.fundId,
      basisHash,
      items: [...valid, { userId: sheet.bala.userId, growthPaise: "-240000" }],
    })
    expect(belowZero.statusCode).toBe(400)
    expect(errorOf(belowZero)).toBe("VALIDATION_FAILED")
    const zeroValue = await commit(`vu-bad-${randomUUID()}`, {
      fundId: sheet.fund.fundId,
      basisHash,
      items: [...valid, { userId: sheet.chitra.userId, growthPaise: "100" }],
    })
    expect(zeroValue.statusCode).toBe(400)
    expect(errorOf(zeroValue)).toBe("VALIDATION_FAILED")

    expect(await writeCounts()).toEqual(counts)
    expect((await gainsOf(sheet.fund.fundId))["Asha Rao"]).toBe("52525")
  })

  test("a retried submit under the same key commits once; a fresh key cannot reapply the stale sheet", async () => {
    const sheet = await seedSheet()
    const items = [{ userId: sheet.dev.userId, growthPaise: "4550" }]
    const basisHash = await preview(sheet.fund.fundId, items)
    const key = `vu-replay-${randomUUID()}`
    const payload = { fundId: sheet.fund.fundId, items, basisHash }

    const first = await commit(key, payload)
    expect(first.statusCode).toBe(201)
    const counts = await writeCounts()
    const replay = await commit(key, payload)
    expect(replay.statusCode).toBe(201)
    expect(dataOf<{ batchId: string }>(replay).batchId).toBe(dataOf<{ batchId: string }>(first).batchId)
    expect(await writeCounts()).toEqual(counts)

    const fresh = await commit(`vu-replay-${randomUUID()}`, payload)
    expect(fresh.statusCode).toBe(409)
    expect(errorOf(fresh)).toBe("STATE_CONFLICT")
    expect(await writeCounts()).toEqual(counts)
    expect((await gainsOf(sheet.fund.fundId))["Dev Shah"]).toBe("4550")
  })

  test("the fund positions read needs client_values.read", async () => {
    const sheet = await seedSheet()
    const support = await createAdmin("support")
    const onboarding = await createAdmin("onboarding")

    for (const session of [support.session, onboarding.session]) {
      const denied = await fundPositions(sheet.fund.fundId, session)
      expect(denied.statusCode).toBe(403)
      expect(errorOf(denied)).toBe("AUTHORIZATION_DENIED")
    }
    const asClient = await app.inject({
      method: "GET",
      url: FUND_POSITIONS(sheet.fund.fundId),
      headers: { authorization: `Bearer ${sheet.asha.token}` },
    })
    expect(asClient.statusCode).toBe(401)
    const anonymous = await app.inject({ method: "GET", url: FUND_POSITIONS(sheet.fund.fundId), headers: { origin: ORIGIN } })
    expect(anonymous.statusCode).toBe(401)
    expect(errorOf(anonymous)).toBe("AUTHENTICATION_REQUIRED")
    expect((await fundPositions(randomUUID())).statusCode).toBe(404)
  })
})

describe("GET /v1/client/value-updates", () => {
  test("lists only the signed-in client's updates with change and value after, newest first, paged", async () => {
    const sheet = await seedSheet()
    await pause()
    const reversed = await individualGrowth(sheet.asha.userId, sheet.fund.fundId, "999")
    await pool.query(
      "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, " +
        "effective_date, reverses_entry_id, reason_code, actor_type, created_by_user_id, request_id) " +
        "values ($1, $2, 'reversal', 0, -999, '2026-09-30', $3, 'correction', 'admin', $4, $5)",
      [sheet.asha.userId, sheet.fund.fundId, reversed, financeId, `req-${randomUUID()}`],
    )
    await pause()
    const items = [{ userId: sheet.asha.userId, growthPaise: "70925" }]
    const basisHash = await preview(sheet.fund.fundId, items)
    expect((await commit(`vu-list-${randomUUID()}`, { fundId: sheet.fund.fundId, items, basisHash })).statusCode).toBe(201)

    const first = await valueUpdates(sheet.asha, "?limit=1")
    expect(first.statusCode).toBe(200)
    const firstItems = dataOf<{ items: ValueUpdate[] }>(first).items
    expect(firstItems).toHaveLength(1)
    expect(firstItems[0]?.fundName).toMatch(/^Fund vu-/u)
    expect(firstItems[0]).toMatchObject({
      fundId: sheet.fund.fundId,
      date: "2026-10-31",
      changePaise: "70925",
      valueAfterPaise: "1123450",
    })
    const cursor = pageOf(first).nextCursor
    expect(cursor).not.toBeNull()

    const second = await valueUpdates(sheet.asha, `?limit=1&after=${encodeURIComponent(cursor!)}`)
    expect(second.statusCode).toBe(200)
    expect(dataOf<{ items: ValueUpdate[] }>(second).items.map((item) => [item.changePaise, item.valueAfterPaise, item.date])).toEqual([
      ["52525", "1052525", "2026-09-30"],
    ])
    expect(pageOf(second).hasMore).toBe(false)

    const bala = await valueUpdates(sheet.bala)
    expect(bala.statusCode).toBe(200)
    expect(dataOf<{ items: ValueUpdate[] }>(bala).items.map((item) => [item.changePaise, item.valueAfterPaise])).toEqual([
      ["-10001", "239999"],
    ])
    const replayed = await valueUpdates(sheet.bala, `?limit=1&after=${encodeURIComponent(cursor!)}`)
    expect(replayed.statusCode).toBe(400)
    expect(errorOf(replayed)).toBe("CURSOR_INVALID")
    expect(dataOf<{ items: ValueUpdate[] }>(await valueUpdates(sheet.dev)).items).toEqual([])

    const anonymous = await app.inject({ method: "GET", url: "/v1/client/value-updates" })
    expect(anonymous.statusCode).toBe(401)
    const asAdmin = await app.inject({ method: "GET", url: "/v1/client/value-updates", headers: adminHeaders(finance) })
    expect(asAdmin.statusCode).toBe(401)
  })
})

describe("GET /v1/client/invested-funds", () => {
  test("names every fund the client holds, archived ones too, and answers 404 for a fund only another client holds", async () => {
    const sheet = await seedSheet()
    const archived = await seedFund(`vu-${randomUUID().slice(0, 8)}`)
    await seedContribution(sheet.asha.userId, archived, 200_000)
    await pause()
    const archivedUpdate = await individualGrowth(sheet.asha.userId, archived.fundId, "4000")
    await pool.query("update funds set state = 'archived', archived_at = now() where id = $1", [archived.fundId])
    const openFund: InvestedFund = {
      fundId: sheet.fund.fundId,
      fundName: await fundNameOf(sheet.fund.versionId),
      fundPublished: true,
    }
    const archivedFund: InvestedFund = {
      fundId: archived.fundId,
      fundName: await fundNameOf(archived.versionId),
      fundPublished: false,
    }

    const listed = await clientGet(sheet.asha, "/v1/client/invested-funds")
    expect(listed.statusCode).toBe(200)
    const expected = [openFund, archivedFund].sort((left, right) => left.fundName.localeCompare(right.fundName))
    expect(dataOf<{ items: InvestedFund[] }>(listed).items).toEqual(expected)
    const own = await clientGet(sheet.asha, `/v1/client/invested-funds/${archived.fundId}`)
    expect(own.statusCode).toBe(200)
    expect(dataOf<{ investedFund: InvestedFund }>(own).investedFund).toEqual(archivedFund)

    const crossRead = await clientGet(sheet.bala, `/v1/client/invested-funds/${archived.fundId}`)
    expect(crossRead.statusCode).toBe(404)
    expect(errorOf(crossRead)).toBe("RESOURCE_NOT_FOUND")
    expect(dataOf<{ items: InvestedFund[] }>(await clientGet(sheet.bala, "/v1/client/invested-funds")).items).toEqual([openFund])
    expect((await clientGet(sheet.asha, `/v1/client/invested-funds/${randomUUID()}`)).statusCode).toBe(404)
    expect(errorOf(await clientGet(sheet.asha, "/v1/client/invested-funds/not-a-fund"))).toBe("VALIDATION_FAILED")
    expect((await app.inject({ method: "GET", url: "/v1/client/invested-funds" })).statusCode).toBe(401)
    const asAdmin = await app.inject({ method: "GET", url: `/v1/client/invested-funds/${archived.fundId}`, headers: adminHeaders(finance) })
    expect(asAdmin.statusCode).toBe(401)

    const filtered = await valueUpdates(sheet.asha, `?fundId=${archived.fundId}`)
    expect(filtered.statusCode).toBe(200)
    expect(dataOf<{ items: ValueUpdate[] }>(filtered).items.map((item) => [item.entryId, item.valueAfterPaise])).toEqual([
      [archivedUpdate, "204000"],
    ])
    expect(dataOf<{ items: ValueUpdate[] }>(await valueUpdates(sheet.bala, `?fundId=${archived.fundId}`)).items).toEqual([])

    const unfiltered = await valueUpdates(sheet.asha, "?limit=1")
    expect(pageOf(unfiltered).hasMore).toBe(true)
    const cursor = encodeURIComponent(pageOf(unfiltered).nextCursor!)
    const rebound = await valueUpdates(sheet.asha, `?limit=1&fundId=${archived.fundId}&after=${cursor}`)
    expect(rebound.statusCode).toBe(400)
    expect(errorOf(rebound)).toBe("CURSOR_INVALID")
  })
})
