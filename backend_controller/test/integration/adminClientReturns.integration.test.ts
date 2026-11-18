import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService } from "../../src/auth/accessToken.js"
import { hashPassword } from "../../src/auth/passwordHasher.js"
import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { createClientReturnsRepository } from "../../src/repositories/clientReturnsRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerAdminClientPositionRoutes } from "../../src/routes/adminClientPositionRoutes.js"
import { registerAdminClientReturnRoutes } from "../../src/routes/adminClientReturnRoutes.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"
import { GROWTH_CONFIG, growthMailDeps } from "./growthMailSupport.js"
import { CRYPTO_ENV } from "./passwordMailSupport.js"

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"
const AS_OF = new Date("2026-11-13T06:30:00.000Z")

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let financeAdminId: string
let finance: Session
let support: Session
let onboarding: Session
let passwordHash: string

interface Session {
  readonly cookie: string
  readonly csrf: string
}

interface Returns {
  readonly investedPaise: string
  readonly currentValuePaise: string
  readonly growthPaise: string
  readonly simpleReturnBasisPoints: string | null
  readonly xirrBasisPoints: string | null
  readonly lastUpdatedAt: string | null
}

interface SummaryPage {
  readonly asOfDate: string
  readonly totals: Returns & { readonly clientCount: number }
  readonly items: readonly (Returns & { readonly userId: string })[]
}

interface PageMeta {
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

interface LedgerItem {
  readonly entryId: string
  readonly entryType: string
  readonly reversible: boolean
}

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const pageOf = (response: { json: () => unknown }): PageMeta => (response.json() as { meta: { page: PageMeta } }).meta.page
const errorOf = (response: { json: () => unknown }): string => (response.json() as { error: { code: string } }).error.code

const nextPhone = (): string => `+1415555${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`

const login = async (email: string): Promise<Session> => {
  const response = await app.inject({ method: "POST", url: "/v1/auth/web/login", headers: { origin: ORIGIN }, payload: { email, password: PASSWORD } })
  expect(response.statusCode).toBe(200)
  const setCookie = response.headers["set-cookie"]
  const cookies = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  return {
    cookie: cookies.map((cookie) => cookie.split(";")[0] ?? "").join("; "),
    csrf: dataOf<{ csrfToken: string }>(response).csrfToken,
  }
}

const createAdmin = async (role: string): Promise<{ readonly userId: string; readonly email: string }> => {
  const email = `returns-${role}-${randomUUID().slice(0, 8)}@example.com`
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) values ($1, $2, 'Admin User', 'active', now()) returning id",
    [email, nextPhone()],
  )
  const userId = user.rows[0]!.id
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [userId, passwordHash])
  for (const permission of SEED_ROLE_PERMISSIONS[role] ?? []) {
    await pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) select r.id, p.id, $1 from roles r, permissions p where r.code = $2 and p.code = $3 on conflict do nothing",
      [userId, role, permission],
    )
  }
  await pool.query("insert into user_roles (user_id, role_id, granted_by_user_id) select $1, id, $1 from roles where code = $2", [userId, role])
  return { userId, email }
}

const seedClient = async (hasPassword = true): Promise<string> => {
  const row = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) values ($1, $2, 'Client Person', 'active', now()) returning id",
    [`client-${randomUUID().slice(0, 8)}@example.com`, nextPhone()],
  )
  const userId = row.rows[0]!.id
  if (hasPassword) await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [userId, passwordHash])
  return userId
}

const seedFund = async (): Promise<{ readonly fundId: string; readonly versionId: string }> => {
  const slug = `returns-${randomUUID().slice(0, 8)}`
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [slug, financeAdminId],
  )
  const fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) values ($1, 1, 'Disclosure', 'Body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), financeAdminId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, $2, 'hybrid', 'Growth.', 'moderate', 'moderate', 50000, 500000, 6, $3, $4, $5) returning id",
    [fundId, `Fund ${slug}`, disclosure.rows[0]!.id, randomBytes(32), financeAdminId],
  )
  const versionId = version.rows[0]!.id
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [versionId, fundId])
  return { fundId, versionId }
}

const contribute = async (userId: string, fund: Awaited<ReturnType<typeof seedFund>>, paise: number, effectiveDate: string): Promise<string> => {
  const order = await pool.query<{ id: string }>(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) values ($1, $2, $3, 'lump_sum', 'accepted', $4, now()) returning id",
    [userId, fund.fundId, fund.versionId, paise],
  )
  const orderId = order.rows[0]!.id
  const payment = await pool.query<{ id: string }>(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, $3, 'succeeded', now()) returning id",
    [orderId, userId, paise],
  )
  const allocation = await pool.query<{ id: string }>(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) values ($1, $2, $3, $4, $5, $6) returning id",
    [orderId, userId, fund.fundId, paise, financeAdminId, `req-${randomUUID()}`],
  )
  const entry = await pool.query<{ id: string }>(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', $4, $4, $5, $6, $7, 'investment_accepted', 'admin', $8, $9) returning id",
    [userId, fund.fundId, allocation.rows[0]!.id, paise, effectiveDate, orderId, payment.rows[0]!.id, financeAdminId, `req-${randomUUID()}`],
  )
  return entry.rows[0]!.id
}

const grow = async (userId: string, fundId: string, paise: number, effectiveDate: string): Promise<string> => {
  const batch = await pool.query<{ id: string }>(
    "insert into client_growth_batches (scope, instruction_type, effective_date, reason_code, basis_hash, actor_user_id, request_id, target_count, total_delta_paise) values ('individual', 'amount', $1, 'valuation', 'hash', $2, $3, 1, $4) returning id",
    [effectiveDate, financeAdminId, `req-${randomUUID()}`, paise],
  )
  const entry = await pool.query<{ id: string }>(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, growth_batch_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'growth_adjustment', 0, $3, $4, $5, 'valuation', 'admin', $6, $7) returning id",
    [userId, fundId, paise, effectiveDate, batch.rows[0]!.id, financeAdminId, `req-${randomUUID()}`],
  )
  return entry.rows[0]!.id
}

const reverse = async (entryId: string): Promise<void> => {
  await pool.query(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, reverses_entry_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "select user_id, fund_id, 'reversal', -principal_delta_paise, -value_delta_paise, effective_date, id, 'admin_correction_reversal', 'admin', $2, $3 from client_value_entries where id = $1",
    [entryId, financeAdminId, `req-${randomUUID()}`],
  )
}

const ledgerTruth = async (userId: string) => {
  const result = await pool.query<{ principal: string; value: string; latest: Date }>(
    "select sum(principal_delta_paise)::text as principal, sum(value_delta_paise)::text as value, max(created_at) as latest from client_value_entries where user_id = $1",
    [userId],
  )
  return result.rows[0]!
}

const get = (session: Session | null, url: string) =>
  app.inject({ method: "GET", url, headers: session === null ? { origin: ORIGIN } : { origin: ORIGIN, cookie: session.cookie } })

let fund: Awaited<ReturnType<typeof seedFund>>
let growingClient: string
let growingContribution: string
let youngClient: string
let emptyClient: string

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 5, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  await runMigrations(pool, await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url))))
  await runSeed(pool)

  passwordHash = await hashPassword(PASSWORD)
  const database = createDatabase(pool)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  const webAuth: WebAuthDeps = {
    userRepository: createUserRepository(),
    authSessionRepository: createAuthSessionRepository(),
    auditRepository: createAuditRepository(),
    accessTokenService: createAccessTokenService({
      issuer: "https://api.beonedge.test",
      audience: "boe-web",
      currentKid: "k1",
      signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
      verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
    }),
    database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rt1",
    csrfKeyVersion: "cs1",
    clock: () => new Date(),
    config: { cookieSecure: false, originAllowlist: [ORIGIN] },
  }
  const unitOfWork = createUnitOfWork(database)
  const writeDeps = {
    webAuth,
    unitOfWork,
    database,
    clock: () => new Date(),
    config: { idempotencyTtlMs: 86_400_000 },
    clientGrowthRepository: createClientGrowthRepository(),
    auditRepository: createAuditRepository(),
    idempotencyRepository: createIdempotencyRepository(),
    notificationRepository: createNotificationRepository(),
  }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerWebAuthRoutes(instance, { ...webAuth, unitOfWork, loginEventRepository: createLoginEventRepository() })
      registerAdminClientGrowthRoutes(instance, { ...writeDeps, ...growthMailDeps(), config: GROWTH_CONFIG })
      registerAdminClientPositionRoutes(instance, {
        ...writeDeps,
        config: { idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" },
        outboxRepository: createOutboxRepository(),
        emailDeliveryRepository: createEmailDeliveryRepository(),
        crypto: createCryptoContext(parseCryptoKeys(CRYPTO_ENV)),
        clientPositionRepository: createClientPositionRepository(),
        userRepository: createUserRepository(),
        sipScheduleRepository: createAdminSipScheduleRepository(),
      })
      registerAdminClientReturnRoutes(instance, {
        webAuth,
        database,
        clock: () => AS_OF,
        config: { cursorKey: randomBytes(32) },
        clientReturnsRepository: createClientReturnsRepository(),
        clientPositionRepository: createClientPositionRepository(),
      })
    },
  })

  const financeAdmin = await createAdmin("finance")
  financeAdminId = financeAdmin.userId
  finance = await login(financeAdmin.email)
  support = await login((await createAdmin("support")).email)
  onboarding = await login((await createAdmin("onboarding")).email)

  fund = await seedFund()
  growingClient = await seedClient()
  growingContribution = await contribute(growingClient, fund, 100_000, "2025-11-13")
  await reverse(await contribute(growingClient, fund, 50_000, "2026-03-01"))
  await grow(growingClient, fund.fundId, 10_000, "2026-06-01")
  youngClient = await seedClient()
  await contribute(youngClient, fund, 200_000, "2026-11-01")
  await grow(youngClient, fund.fundId, -20_000, "2026-11-10")
  emptyClient = await seedClient()
}, 220_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("admin client returns", () => {
  test("a client's summary matches its ledger rows, nets the reversal and annualises over the IST day", async () => {
    const response = await get(finance, `/v1/admin/clients/${growingClient}/portfolio-summary`)
    expect(response.statusCode, response.body).toBe(200)
    const truth = await ledgerTruth(growingClient)
    expect(dataOf<Returns & { userId: string; asOfDate: string }>(response)).toEqual({
      userId: growingClient,
      asOfDate: "2026-11-13",
      investedPaise: truth.principal,
      currentValuePaise: truth.value,
      growthPaise: String(BigInt(truth.value) - BigInt(truth.principal)),
      simpleReturnBasisPoints: "1000",
      xirrBasisPoints: "1000",
      lastUpdatedAt: truth.latest.toISOString(),
    })
    expect(truth.principal).toBe("100000")
    expect(truth.value).toBe("110000")
  })

  test("a short history has no XIRR and an empty ledger has no return", async () => {
    const young = dataOf<Returns>(await get(finance, `/v1/admin/clients/${youngClient}/portfolio-summary`))
    expect(young).toMatchObject({ investedPaise: "200000", currentValuePaise: "180000", simpleReturnBasisPoints: "-1000", xirrBasisPoints: null })
    const empty = dataOf<Returns>(await get(finance, `/v1/admin/clients/${emptyClient}/portfolio-summary`))
    expect(empty).toEqual(expect.objectContaining({ investedPaise: "0", currentValuePaise: "0", simpleReturnBasisPoints: null, xirrBasisPoints: null, lastUpdatedAt: null }))
    const missing = await get(finance, `/v1/admin/clients/${randomUUID()}/portfolio-summary`)
    expect(missing.statusCode).toBe(404)
  })

  test("the summary list sorts by return, totals the selected clients and pages with a signed cursor", async () => {
    const ids = [emptyClient, youngClient, growingClient].join(",")
    const all = await get(finance, `/v1/admin/client-values/summary?userIds=${ids}`)
    expect(all.statusCode, all.body).toBe(200)
    const data = dataOf<SummaryPage>(all)
    expect(data.items.map((item) => item.userId)).toEqual([growingClient, youngClient, emptyClient])
    expect(data.totals).toEqual(expect.objectContaining({ clientCount: 3, investedPaise: "300000", currentValuePaise: "290000", growthPaise: "-10000", simpleReturnBasisPoints: "-333", xirrBasisPoints: "-936" }))

    const ascending = dataOf<SummaryPage>(await get(finance, `/v1/admin/client-values/summary?userIds=${ids}&sort=return_asc`))
    expect(ascending.items.map((item) => item.userId)).toEqual([youngClient, growingClient, emptyClient])

    const seen: SummaryPage["items"][number][] = []
    let cursor: string | null = null
    do {
      const url = `/v1/admin/client-values/summary?userIds=${ids}&limit=1${cursor === null ? "" : `&after=${encodeURIComponent(cursor)}`}`
      const page = await get(finance, url)
      expect(page.statusCode, page.body).toBe(200)
      expect(dataOf<SummaryPage>(page).totals).toEqual(data.totals)
      seen.push(...dataOf<SummaryPage>(page).items)
      cursor = pageOf(page).nextCursor
    } while (cursor !== null)
    expect(seen).toEqual(data.items)
    expect(seen.map((item) => item.xirrBasisPoints)).toEqual(["1000", null, null])

    const first = await get(finance, `/v1/admin/client-values/summary?userIds=${ids}&limit=1`)
    const replayed = await get(finance, `/v1/admin/client-values/summary?sort=return_asc&userIds=${ids}&after=${encodeURIComponent(pageOf(first).nextCursor ?? "")}`)
    expect(errorOf(replayed)).toBe("CURSOR_INVALID")

    const unfiltered = dataOf<SummaryPage>(await get(finance, "/v1/admin/client-values/summary?limit=100"))
    expect(unfiltered.items.map((item) => item.userId)).toEqual(expect.arrayContaining([growingClient, youngClient]))
    expect(unfiltered.items.map((item) => item.userId)).not.toContain(emptyClient)
  })

  test("sums match the positions read, and the last live contribution under growth cannot be reversed", async () => {
    const positions = dataOf<{ items: { principalPaise: string; currentValuePaise: string }[] }>(
      await get(finance, `/v1/admin/client-growth/investors/${growingClient}/positions`),
    )
    const before = dataOf<Returns>(await get(finance, `/v1/admin/clients/${growingClient}/portfolio-summary`))
    expect(String(positions.items.reduce((sum, item) => sum + BigInt(item.principalPaise), 0n))).toBe(before.investedPaise)
    expect(String(positions.items.reduce((sum, item) => sum + BigInt(item.currentValuePaise), 0n))).toBe(before.currentValuePaise)

    const refused = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${growingClient}/ledger-entries/${growingContribution}/reversal`,
      headers: { origin: ORIGIN, cookie: finance.cookie, "x-csrf-token": finance.csrf, "idempotency-key": randomUUID() },
      payload: { reasonCode: "admin_correction_reversal" },
    })
    expect(refused.statusCode, refused.body).toBe(409)
    expect(errorOf(refused)).toBe("STATE_CONFLICT")
    expect(dataOf<Returns>(await get(finance, `/v1/admin/clients/${growingClient}/portfolio-summary`))).toEqual(before)
  })

  test("the ledger page walks every entry once, newest first", async () => {
    const seen: LedgerItem[] = []
    let cursor: string | null = null
    do {
      const page = await get(finance, `/v1/admin/clients/${growingClient}/ledger?limit=2${cursor === null ? "" : `&after=${encodeURIComponent(cursor)}`}`)
      expect(page.statusCode, page.body).toBe(200)
      seen.push(...dataOf<{ items: LedgerItem[] }>(page).items)
      cursor = pageOf(page).nextCursor
    } while (cursor !== null)
    expect(seen.map((item) => item.entryType)).toEqual(["growth_adjustment", "reversal", "contribution", "contribution"])
    expect(new Set(seen.map((item) => item.entryId)).size).toBe(4)
    expect(seen.filter((item) => item.reversible)).toHaveLength(2)

    const first = await get(finance, `/v1/admin/clients/${growingClient}/ledger?limit=2`)
    const crossed = await get(finance, `/v1/admin/clients/${youngClient}/ledger?limit=2&after=${encodeURIComponent(pageOf(first).nextCursor ?? "")}`)
    expect(errorOf(crossed)).toBe("CURSOR_INVALID")
  })

  test("overview reads count uninvited clients and report each fund's last value update", async () => {
    const before = dataOf<{ count: number }>(await get(onboarding, "/v1/admin/overview/pending-invites")).count
    await seedClient(false)
    await seedClient(true)
    const after = await get(onboarding, "/v1/admin/overview/pending-invites")
    expect(after.statusCode, after.body).toBe(200)
    expect(dataOf<{ count: number }>(after).count).toBe(before + 1)

    const quiet = await seedFund()
    const updates = dataOf<{ items: { fundId: string; lastValueUpdateAt: string | null; lastValueUpdateEffectiveDate: string | null }[] }>(
      await get(finance, "/v1/admin/client-values/fund-updates"),
    )
    const latest = await pool.query<{ created_at: Date }>(
      "select created_at from client_value_entries where fund_id = $1 and entry_type = 'growth_adjustment' order by created_at desc limit 1",
      [fund.fundId],
    )
    expect(updates.items.find((item) => item.fundId === fund.fundId)).toMatchObject({
      lastValueUpdateAt: latest.rows[0]!.created_at.toISOString(),
      lastValueUpdateEffectiveDate: "2026-11-10",
    })
    expect(updates.items.find((item) => item.fundId === quiet.fundId)).toMatchObject({ lastValueUpdateAt: null })
  })

  test("returns and ledger reads are refused without client_values.read, invites without users.read", async () => {
    const returnsUrls = [
      `/v1/admin/clients/${growingClient}/portfolio-summary`,
      "/v1/admin/client-values/summary",
      "/v1/admin/client-values/fund-updates",
      `/v1/admin/clients/${growingClient}/ledger`,
    ]
    for (const url of returnsUrls) {
      for (const session of [support, onboarding]) {
        const refused = await get(session, url)
        expect(refused.statusCode, url).toBe(403)
        expect(errorOf(refused)).toBe("AUTHORIZATION_DENIED")
        expect(refused.body).not.toContain("110000")
      }
      expect((await get(null, url)).statusCode).toBe(401)
    }
    for (const session of [support, finance]) {
      const refused = await get(session, "/v1/admin/overview/pending-invites")
      expect(errorOf(refused)).toBe("AUTHORIZATION_DENIED")
    }
  })
})
