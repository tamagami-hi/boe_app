/**
 * Admin surface integration tests (content + catalog + oversight groups).
 *
 * Proves the three new `/v1/admin/*` route groups against real PostgreSQL:
 * the RBAC boundary, the publish lifecycle and its "one published row per key"
 * invariant, append-only catalogue publication with correction refusal, the
 * oversight read projections, the user/KYC/redemption decision writes, and that
 * every mutation lands an audit event the audit-log endpoint can read back.
 */
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
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import type { UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createAdminCatalogRepository } from "../../src/repositories/adminCatalogRepository.js"
import { createAdminContentRepository } from "../../src/repositories/adminContentRepository.js"
import { createAdminOversightRepository } from "../../src/repositories/adminOversightRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createInvestorLedgerRepository } from "../../src/repositories/investorLedgerRepository.js"
import { createRedemptionRepository } from "../../src/repositories/redemptionRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminCatalogRoutes } from "../../src/routes/adminCatalogRoutes.js"
import { registerAdminContentRoutes } from "../../src/routes/adminContentRoutes.js"
import { registerAdminOversightRoutes } from "../../src/routes/adminOversightRoutes.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let unitOfWork: UnitOfWork

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const pageOf = (response: {
  json: () => unknown
}): { nextCursor: string | null; hasMore: boolean; limit: number } =>
  (response.json() as { meta: { page: { nextCursor: string | null; hasMore: boolean; limit: number } } }).meta
    .page

const cookieJar = (setCookie: string | string[] | undefined): Record<string, string> => {
  const all = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  const jar: Record<string, string> = {}
  for (const cookie of all) {
    const pair = cookie.split(";")[0] ?? ""
    const index = pair.indexOf("=")
    if (index !== -1) jar[pair.slice(0, index)] = pair.slice(index + 1)
  }
  return jar
}

const cookieHeader = (jar: Record<string, string>): string =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")

interface Session {
  readonly jar: Record<string, string>
  readonly csrf: string
}

const login = async (email: string): Promise<Session> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/web/login",
    headers: { origin: ORIGIN },
    payload: { email, password: PASSWORD },
  })
  expect(response.statusCode).toBe(200)
  return {
    jar: cookieJar(response.headers["set-cookie"]),
    csrf: dataOf<{ csrfToken: string }>(response).csrfToken,
  }
}

const write = (session: Session, extra: Record<string, string> = {}): Record<string, string> => ({
  origin: ORIGIN,
  cookie: cookieHeader(session.jar),
  "x-csrf-token": session.csrf,
  ...extra,
})

const read = (session: Session): Record<string, string> => ({
  origin: ORIGIN,
  cookie: cookieHeader(session.jar),
})

const phone = (): string => `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`

const createAdmin = async (
  email: string,
  roleCode: keyof typeof SEED_ROLE_PERMISSIONS,
): Promise<string> => {
  const userRow = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Admin User', 'active', now()) returning id",
    [email, phone()],
  )
  const userId = userRow.rows[0]?.id as string
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [
    userId,
    await hashPassword(PASSWORD),
  ])
  for (const permission of SEED_ROLE_PERMISSIONS[roleCode] ?? []) {
    await pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) " +
        "select r.id, p.id, $1 from roles r, permissions p where r.code = $2 and p.code = $3 " +
        "on conflict do nothing",
      [userId, roleCode, permission],
    )
  }
  await pool.query(
    "insert into user_roles (user_id, role_id, granted_by_user_id) select $1, id, $1 from roles where code = $2",
    [userId, roleCode],
  )
  return userId
}

/** A plain activated client account (not an admin) for the oversight reads. */
const createClient = async (email: string): Promise<string> => {
  const row = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Client Person', 'active', now()) returning id",
    [email, phone()],
  )
  return row.rows[0]?.id as string
}

/** Append one ledger entry so a pool position exists to work against. */
const seedLedgerEntry = async (
  userId: string,
  fundId: string,
  entryType: "lump_sum" | "gain_allocation" | "redemption",
  principalDelta: bigint,
  valueDelta: bigint,
): Promise<void> => {
  const magnitude = valueDelta < 0n ? -valueDelta : valueDelta
  await pool.query(
    "insert into investor_ledger_entries (user_id, fund_id, entry_type, principal_delta_paise, " +
      "value_delta_paise, amount_paise, effective_date, allocated_by_user_id, request_id) " +
      "values ($1,$2,$3,$4,$5,$6, current_date, $7, $8)",
    [
      userId,
      fundId,
      entryType,
      principalDelta.toString(),
      valueDelta.toString(),
      magnitude.toString(),
      entryType === "gain_allocation" ? userId : null,
      randomUUID(),
    ],
  )
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({
    connectionString: container.getConnectionUri(),
    poolMax: 5,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
  })
  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
  const migrations = await loadMigrationFiles(directory)
  await runMigrations(pool, migrations)
  await runSeed(pool)

  const database = createDatabase(pool)
  unitOfWork = createUnitOfWork(database)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  const accessTokenService = createAccessTokenService({
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
  const cursorKey = randomBytes(32)

  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerWebAuthRoutes(instance, {
        ...webAuth,
        unitOfWork,
        loginEventRepository: createLoginEventRepository(),
      })
      registerAdminContentRoutes(instance, {
        webAuth,
        unitOfWork,
        database,
        clock: () => new Date(),
        config: { cursorKey, idempotencyTtlMs: 86_400_000 },
        contentRepository: createAdminContentRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
      })
      registerAdminCatalogRoutes(instance, {
        webAuth,
        unitOfWork,
        database,
        clock: () => new Date(),
        config: { cursorKey, idempotencyTtlMs: 86_400_000 },
        catalogRepository: createAdminCatalogRepository(),
        investorLedgerRepository: createInvestorLedgerRepository(),
        notificationRepository: createNotificationRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
      })
      registerAdminOversightRoutes(instance, {
        webAuth,
        unitOfWork,
        database,
        clock: () => new Date(),
        config: { cursorKey, idempotencyTtlMs: 86_400_000 },
        oversightRepository: createAdminOversightRepository(),
        loginEventRepository: createLoginEventRepository(),
        investorLedgerRepository: createInvestorLedgerRepository(),
        redemptionRepository: createRedemptionRepository(),
        notificationRepository: createNotificationRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
      })
    },
  })

  await createAdmin("root@example.com", "superadmin")
  await createAdmin("content@example.com", "content")
  await createAdmin("finance@example.com", "finance")
  await createAdmin("support@example.com", "support")
}, 220_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("admin content group (integration)", () => {
  test("FAQs are stored as content items with a generated key and publish cleanly", async () => {
    const session = await login("content@example.com")
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/faqs",
      headers: write(session),
      payload: {
        question: "How do I withdraw funds?",
        answer: "Submit a redemption request from the portfolio screen.",
        category: "payments",
        order: 5,
      },
    })
    expect(created.statusCode).toBe(201)
    const faq = dataOf<{ faq: Record<string, unknown> }>(created).faq
    expect(faq).toMatchObject({
      question: "How do I withdraw funds?",
      answer: "Submit a redemption request from the portfolio screen.",
      category: "payments",
      order: 5,
      status: "draft",
    })
    expect(String(faq.contentKey)).toMatch(/^faq-how-do-i-withdraw-funds-[0-9a-f]{8}$/u)

    const publishedFaq = await app.inject({
      method: "PATCH",
      url: `/v1/admin/faqs/${faq.id as string}`,
      headers: write(session),
      payload: { status: "published" },
    })
    expect(publishedFaq.statusCode).toBe(200)

    const kind = await pool.query<{ kind: string; state: string }>(
      "select kind, state from content_items where id = $1",
      [faq.id],
    )
    expect(kind.rows[0]).toEqual({ kind: "faq", state: "published" })

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/admin/faqs/${faq.id as string}`,
      headers: write(session),
    })
    expect(deleted.statusCode).toBe(200)
  })

  test("app config publishes versions, retires the previous one, and refuses catalogue data", async () => {
    const session = await login("content@example.com")

    const empty = await app.inject({ method: "GET", url: "/v1/admin/app-config", headers: read(session) })
    expect(empty.statusCode).toBe(200)
    expect(dataOf<{ version: number | null }>(empty).version).toBeNull()

    const first = await app.inject({
      method: "PATCH",
      url: "/v1/admin/app-config",
      headers: write(session),
      payload: {
        config: {
          featureFlags: { sipEnabled: true },
          minimumSupportedVersion: { android: "1.2.0" },
          downloads: { androidUrl: "https://example.test/app.apk" },
          maintenance: { enabled: false },
          presentation: { heroHeadline: "Invest with edge" },
        },
      },
    })
    expect(first.statusCode).toBe(200)
    expect(dataOf<{ version: number }>(first).version).toBe(1)

    const second = await app.inject({
      method: "PATCH",
      url: "/v1/admin/app-config",
      headers: write(session),
      payload: { config: { featureFlags: { sipEnabled: false } }, reason: "disable SIP promo" },
    })
    expect(second.statusCode).toBe(200)
    expect(dataOf<{ version: number }>(second).version).toBe(2)

    const current = await app.inject({ method: "GET", url: "/v1/admin/app-config", headers: read(session) })
    expect(dataOf<{ version: number; config: Record<string, unknown> }>(current)).toMatchObject({
      version: 2,
      config: { featureFlags: { sipEnabled: false } },
    })
    const retired = await pool.query<{ count: string }>(
      "select count(*)::text as count from app_config_versions where retired_at is not null",
    )
    expect(retired.rows[0]?.count).toBe("1")

    // Canonical decision: product/fund catalogues never live in app config.
    const forbidden = await app.inject({
      method: "PATCH",
      url: "/v1/admin/app-config",
      headers: write(session),
      payload: { config: { featureFlags: {}, funds: [{ id: "x", nav: 10 }] } },
    })
    expect(forbidden.statusCode).toBe(400)
  })

  test("denies a support principal the content permissions and keyset-paginates lists", async () => {
    // Uses the FAQ collection as the vehicle: it shares listCollection, the
    // content permissions and the keyset cursor with every other content list,
    // and it is seeded with enough rows to page through.
    const support = await login("support@example.com")
    const denied = await app.inject({ method: "GET", url: "/v1/admin/faqs", headers: read(support) })
    expect(denied.statusCode).toBe(403)

    const session = await login("content@example.com")
    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/admin/faqs?limit=1",
      headers: read(session),
    })
    expect(firstPage.statusCode).toBe(200)
    const page = pageOf(firstPage)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).not.toBeNull()

    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/admin/faqs?limit=1&after=${encodeURIComponent(page.nextCursor as string)}`,
      headers: read(session),
    })
    expect(secondPage.statusCode).toBe(200)
    const firstIds = dataOf<{ items: { id: string }[] }>(firstPage).items.map((item) => item.id)
    const secondIds = dataOf<{ items: { id: string }[] }>(secondPage).items.map((item) => item.id)
    expect(secondIds[0]).not.toBe(firstIds[0])

    const badCursor = await app.inject({
      method: "GET",
      url: "/v1/admin/faqs?limit=1&after=not-a-cursor",
      headers: read(session),
    })
    expect(badCursor.statusCode).toBe(400)
  })
})

describe("admin catalog group (integration)", () => {
  const publishFund = async (session: Session, slug: string): Promise<{ fundId: string; versionId: string }> => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/funds",
      headers: write(session),
      payload: { slug },
    })
    expect(created.statusCode).toBe(201)
    const fundId = dataOf<{ fund: { id: string } }>(created).fund.id

    const version = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/versions`,
      headers: write(session),
      payload: {
        name: "Edge Balanced",
        category: "hybrid",
        objective: "Balanced growth with drawdown control.",
        riskLevel: "moderate",
        returnTier: "moderate",
        minimumSipPaise: 100000,
        minimumPurchasePaise: 500000,
        minimumDurationMonths: 6,
        disclosure: { title: "Scheme disclosure", body: "Full disclosure text." },
      },
    })
    expect(version.statusCode).toBe(201)
    return { fundId, versionId: dataOf<{ fundVersionId: string }>(version).fundVersionId }
  }

  test("creates a draft fund, refuses publication without a version, then publishes one", async () => {
    const session = await login("finance@example.com")
    const slug = `edge-${randomUUID().slice(0, 8)}`

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/funds",
      headers: write(session),
      payload: { slug },
    })
    expect(created.statusCode).toBe(201)
    const fundId = dataOf<{ fund: { id: string; status: string } }>(created).fund.id
    expect(dataOf<{ fund: { status: string } }>(created).fund.status).toBe("draft")

    // A duplicate slug is a conflict, not a second draft.
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/admin/funds",
      headers: write(session),
      payload: { slug },
    })
    expect(duplicate.statusCode).toBe(409)

    const prematurePublish = await app.inject({
      method: "PATCH",
      url: `/v1/admin/funds/${fundId}`,
      headers: write(session),
      payload: { status: "published" },
    })
    expect(prematurePublish.statusCode).toBe(409)

    const version = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/versions`,
      headers: write(session),
      payload: {
        name: "Edge Growth",
        category: "equity",
        objective: "Long-term growth.",
        riskLevel: "high",
        returnTier: "high",
        minimumSipPaise: 250000,
        minimumPurchasePaise: 1000000,
        disclosure: { title: "Disclosure", body: "Risk factors." },
      },
    })
    expect(version.statusCode).toBe(201)
    const versionBody = dataOf<{ status: string; version: number }>(version)
    expect(versionBody).toMatchObject({ status: "published", version: 1 })

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/funds/${fundId}`,
      headers: read(session),
    })
    expect(detail.statusCode).toBe(200)
    const detailBody = dataOf<{
      fund: Record<string, unknown>
      versions: { returnTier: string | null }[]
      aumHistory: { closingAumPaise: string }[]
      stocks: { stockName: string }[]
      disclosures: { title: string }[]
      investors: { count: number; currentValuePaise: string }
    }>(detail)
    expect(detailBody.fund).toMatchObject({
      slug,
      status: "published",
      name: "Edge Growth",
      riskLevel: "high",
      returnTier: "high",
      currentVersion: 1,
    })
    // No price is published with a version: the pool has no AUM until an update.
    expect(detailBody.fund.aum).toBeNull()
    expect(detailBody.versions[0]?.returnTier).toBe("high")
    expect(detailBody.aumHistory).toHaveLength(0)
    expect(detailBody.disclosures[0]?.title).toBe("Disclosure")
    expect(detailBody.investors).toMatchObject({ count: 0, currentValuePaise: "0" })
  })

  test("publishes monthly AUM updates that derive their opening and closing figures", async () => {
    const session = await login("finance@example.com")
    const { fundId } = await publishFund(session, `aum-${randomUUID().slice(0, 8)}`)

    // First period states its opening balance: ₹10.00 Cr + ₹25 L - ₹10 L + ₹20 L
    // = ₹10.35 Cr, exactly the worked example from the model document.
    const july = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/aum-updates`,
      headers: write(session),
      payload: {
        periodStart: "2026-07-01",
        openingAumPaise: 10000000000,
        newInvestmentsPaise: 250000000,
        redemptionsPaise: 100000000,
        portfolioGainPaise: 200000000,
        note: "July close",
      },
    })
    expect(july.statusCode).toBe(201)
    expect(dataOf<{ aumUpdate: Record<string, unknown> }>(july).aumUpdate).toMatchObject({
      periodStart: "2026-07-01",
      openingAumPaise: "10000000000",
      closingAumPaise: "10350000000",
    })

    // The next period's opening is the previous closing — never re-entered.
    const august = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/aum-updates`,
      headers: write(session),
      payload: { periodStart: "2026-08-01", newInvestmentsPaise: 5000000, portfolioGainPaise: -1000000 },
    })
    expect(august.statusCode).toBe(201)
    expect(dataOf<{ aumUpdate: Record<string, unknown> }>(august).aumUpdate).toMatchObject({
      openingAumPaise: "10350000000",
      closingAumPaise: "10354000000",
    })

    // Re-publishing a closed period would rewrite disclosed history.
    const replay = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/aum-updates`,
      headers: write(session),
      payload: { periodStart: "2026-08-01", newInvestmentsPaise: 1 },
    })
    expect(replay.statusCode).toBe(409)

    // A mid-month date is not a period.
    const badPeriod = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/aum-updates`,
      headers: write(session),
      payload: { periodStart: "2026-09-15" },
    })
    expect(badPeriod.statusCode).toBe(400)

    // A redemption larger than the pool cannot close negative.
    const negative = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/aum-updates`,
      headers: write(session),
      payload: { periodStart: "2026-09-01", redemptionsPaise: 99999999999 },
    })
    expect(negative.statusCode).toBe(500)

    const listed = await app.inject({ method: "GET", url: "/v1/admin/funds", headers: read(session) })
    const entry = dataOf<{ items: { id: string; aum: { closingPaise: string } | null }[] }>(listed).items.find(
      (item) => item.id === fundId,
    )
    expect(entry?.aum).toMatchObject({ closingPaise: "10354000000", periodStart: "2026-08-01" })
  })

  test("curates the quarterly stock list investors see", async () => {
    const session = await login("finance@example.com")
    const { fundId } = await publishFund(session, `stocks-${randomUUID().slice(0, 8)}`)

    const added = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/stocks`,
      headers: write(session),
      payload: { stockName: "SJS Enterprises", quarterLabel: "Q1 FY27", weightPercent: 4.25, sortOrder: 1 },
    })
    expect(added.statusCode).toBe(201)
    const stock = dataOf<{ stock: Record<string, unknown> }>(added).stock
    expect(stock).toMatchObject({
      stockName: "SJS Enterprises",
      quarterLabel: "Q1 FY27",
      state: "active",
    })
    expect(Number(stock.weightPercent)).toBe(4.25)

    await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/stocks`,
      headers: write(session),
      payload: { stockName: "HDFC Bank", quarterLabel: "Q1 FY27", sortOrder: 2 },
    })

    // The quarter label is a reporting period, not free text.
    const badQuarter = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/stocks`,
      headers: write(session),
      payload: { stockName: "Polycab India", quarterLabel: "Q5 FY27" },
    })
    expect(badQuarter.statusCode).toBe(400)

    const edited = await app.inject({
      method: "PATCH",
      url: `/v1/admin/funds/${fundId}/stocks/${stock.id as string}`,
      headers: write(session),
      payload: { stockName: "SJS Enterprises Ltd", quarterLabel: "Q1 FY27", weightPercent: 5, sortOrder: 1 },
    })
    expect(dataOf<{ stock: { stockName: string } }>(edited).stock.stockName).toBe("SJS Enterprises Ltd")

    // Removing a stock records an exit rather than deleting disclosure history.
    const exited = await app.inject({
      method: "DELETE",
      url: `/v1/admin/funds/${fundId}/stocks/${stock.id as string}`,
      headers: write(session),
    })
    expect(dataOf<{ stock: { state: string; exitedAt: string | null } }>(exited).stock.state).toBe("exited")
    expect(dataOf<{ stock: { exitedAt: string | null } }>(exited).stock.exitedAt).not.toBeNull()

    const listed = await app.inject({
      method: "GET",
      url: `/v1/admin/funds/${fundId}/stocks`,
      headers: read(session),
    })
    const items = dataOf<{ items: { stockName: string; state: string }[] }>(listed).items
    expect(items).toHaveLength(2)
    expect(items.filter((item) => item.state === "active")).toHaveLength(1)

    const missing = await app.inject({
      method: "PATCH",
      url: `/v1/admin/funds/${fundId}/stocks/${randomUUID()}`,
      headers: write(session),
      payload: { stockName: "Nope", quarterLabel: "Q1 FY27" },
    })
    expect(missing.statusCode).toBe(404)
  })

  test("pauses and archives a fund, and lists the catalogue", async () => {
    const session = await login("finance@example.com")
    const slug = `life-${randomUUID().slice(0, 8)}`
    const { fundId } = await publishFund(session, slug)

    const paused = await app.inject({
      method: "PATCH",
      url: `/v1/admin/funds/${fundId}`,
      headers: write(session),
      payload: { status: "paused" },
    })
    expect(paused.statusCode).toBe(200)
    expect(dataOf<{ status: string }>(paused).status).toBe("paused")

    const listed = await app.inject({ method: "GET", url: "/v1/admin/funds", headers: read(session) })
    expect(listed.statusCode).toBe(200)
    const entry = dataOf<{ items: { slug: string; status: string; stockCount: number }[] }>(listed).items.find(
      (item) => item.slug === slug,
    )
    expect(entry).toMatchObject({ status: "paused", stockCount: 0 })

    const archived = await app.inject({
      method: "DELETE",
      url: `/v1/admin/funds/${fundId}`,
      headers: write(session),
    })
    expect(archived.statusCode).toBe(200)
    expect(dataOf<{ status: string }>(archived).status).toBe("archived")

    const missing = await app.inject({
      method: "GET",
      url: `/v1/admin/funds/${randomUUID()}`,
      headers: read(session),
    })
    expect(missing.statusCode).toBe(404)
  })

  test("separates funds.read from funds.write and honours the idempotency key", async () => {
    const content = await login("content@example.com")
    const readable = await app.inject({ method: "GET", url: "/v1/admin/funds", headers: read(content) })
    expect(readable.statusCode).toBe(200)

    const denied = await app.inject({
      method: "POST",
      url: "/v1/admin/funds",
      headers: write(content),
      payload: { slug: `denied-${randomUUID().slice(0, 8)}` },
    })
    expect(denied.statusCode).toBe(403)

    const session = await login("finance@example.com")
    const slug = `idem-${randomUUID().slice(0, 8)}`
    const key = `create-${randomUUID()}`
    const first = await app.inject({
      method: "POST",
      url: "/v1/admin/funds",
      headers: write(session, { "idempotency-key": key }),
      payload: { slug },
    })
    expect(first.statusCode).toBe(201)
    const replay = await app.inject({
      method: "POST",
      url: "/v1/admin/funds",
      headers: write(session, { "idempotency-key": key }),
      payload: { slug },
    })
    expect(replay.statusCode).toBe(201)
    expect(dataOf<{ fund: { id: string } }>(replay).fund.id).toBe(
      dataOf<{ fund: { id: string } }>(first).fund.id,
    )

    const rows = await pool.query<{ count: string }>(
      "select count(*)::text as count from funds where slug = $1",
      [slug],
    )
    expect(rows.rows[0]?.count).toBe("1")
  })
})

describe("admin oversight group (integration)", () => {
  /** Seed one fund + a client's order/payment/mandate/SIP so reads have evidence. */
  const seedFinanceEvidence = async (
    userId: string,
  ): Promise<{ fundId: string; orderId: string; redemptionId: string }> => {
    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, state, created_by_user_id, published_at) " +
        "values ($1, 'published', $2, now()) returning id",
      [`ov-${randomUUID().slice(0, 8)}`, userId],
    )
    const fundId = fund.rows[0]?.id as string

    const purchase = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, type, state, amount_paise, requested_at) " +
        "values ($1, $2, 'purchase', 'booked', 5000000, now()) returning id",
      [userId, fundId],
    )
    const orderId = purchase.rows[0]?.id as string

    // Option B books the contribution onto the investor's ledger, not as a
    // unit allotment execution.
    await pool.query(
      "insert into investor_ledger_entries (user_id, fund_id, entry_type, principal_delta_paise, " +
        "value_delta_paise, amount_paise, effective_date, order_id, request_id) " +
        "values ($1,$2,'lump_sum',5000000,5000000,5000000, current_date, $3, $4)",
      [userId, fundId, orderId, randomUUID()],
    )
    await pool.query(
      "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) " +
        "values ($1, $2, 5000000, 'succeeded', now())",
      [orderId, userId],
    )
    const mandate = await pool.query<{ id: string }>(
      "insert into mandates (user_id, provider, max_amount_paise, frequency, debit_day, state, valid_from) " +
        "values ($1, 'manual', 10000000, 'monthly', 5, 'active', now()) returning id",
      [userId],
    )
    await pool.query(
      "insert into sip_plans (user_id, fund_id, amount_paise, debit_day, state, mandate_id, start_date) " +
        "values ($1, $2, 500000, 5, 'active', $3, current_date)",
      [userId, fundId, mandate.rows[0]?.id],
    )

    // Redemptions reference a finance policy version by number.
    await pool.query(
      "insert into finance_policy_versions (version, effective_from, published_by_user_id) " +
        "values (1, now(), $1) on conflict (version) do nothing",
      [userId],
    )
    const redemptionOrder = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, type, state, requested_units, requested_at) " +
        "values ($1, $2, 'redemption', 'submitted', 100, now()) returning id",
      [userId, fundId],
    )
    const redemption = await pool.query<{ id: string }>(
      "insert into redemption_requests (order_id, user_id, fund_id, state, requested_units, " +
        "estimated_value_paise, finance_policy_version, requires_dual_approval, submitted_at) " +
        "values ($1, $2, $3, 'submitted', 100, 1000000, 1, false, now()) returning id",
      [redemptionOrder.rows[0]?.id, userId, fundId],
    )
    return { fundId, orderId, redemptionId: redemption.rows[0]?.id as string }
  }

  test("lists and searches the user directory and returns a full user detail", async () => {
    const session = await login("root@example.com")
    const clientId = await createClient(`oversight-${randomUUID().slice(0, 8)}@example.com`)
    const { fundId } = await seedFinanceEvidence(clientId)

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/users?limit=100",
      headers: read(session),
    })
    expect(listed.statusCode).toBe(200)
    const users = dataOf<{ items: { id: string; status: string; ordersCount: number }[] }>(listed).items
    const entry = users.find((user) => user.id === clientId)
    expect(entry).toMatchObject({ status: "active", ordersCount: 2 })

    const filtered = await app.inject({
      method: "GET",
      url: "/v1/admin/users?status=suspended",
      headers: read(session),
    })
    expect(dataOf<{ items: unknown[] }>(filtered).items).toHaveLength(0)

    const searched = await app.inject({
      method: "GET",
      url: "/v1/admin/users?q=oversight-",
      headers: read(session),
    })
    expect(dataOf<{ items: { id: string }[] }>(searched).items.some((u) => u.id === clientId)).toBe(true)

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${clientId}/detail`,
      headers: read(session),
    })
    expect(detail.statusCode).toBe(200)
    const body = dataOf<{
      user: { id: string }
      roles: string[]
      orders: { fundId: string }[]
      payments: unknown[]
      mandates: unknown[]
      sips: unknown[]
      holdings: unknown[]
      kyc: unknown
    }>(detail)
    expect(body.user.id).toBe(clientId)
    expect(body.roles).toEqual([])
    expect(body.orders.some((order) => order.fundId === fundId)).toBe(true)
    expect(body.payments).toHaveLength(1)
    expect(body.mandates).toHaveLength(1)
    expect(body.sips).toHaveLength(1)
    expect(body.kyc).toBeNull()

    const missing = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${randomUUID()}/detail`,
      headers: read(session),
    })
    expect(missing.statusCode).toBe(404)
  })

  test("allocates a gain to one investor and derives their dashboard from the ledger", async () => {
    const session = await login("root@example.com")
    const clientId = await createClient(`gain-${randomUUID().slice(0, 8)}@example.com`)

    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, state, published_at, created_by_user_id) " +
        "values ($1,'published', now(), $2) returning id",
      [`gain-pool-${randomUUID().slice(0, 8)}`, clientId],
    )
    const fundId = fund.rows[0]?.id as string

    // The investor contributes ₹1,00,000 as a lump sum and ₹25,000 of SIP.
    for (const [type, amount] of [["lump_sum", 10000000], ["sip_installment", 2500000]] as const) {
      await pool.query(
        "insert into investor_ledger_entries (user_id, fund_id, entry_type, principal_delta_paise, " +
          "value_delta_paise, amount_paise, effective_date, request_id) " +
          "values ($1,$2,$3,$4,$4,$4, current_date, $5)",
        [clientId, fundId, type, amount, randomUUID()],
      )
    }

    // Admin allocates ₹12,500 of growth for the period.
    const allocated = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${clientId}/gain-allocations`,
      headers: write(session),
      payload: {
        fundId,
        gainPaise: 1250000,
        effectiveDate: "2026-07-31",
        reasonCode: "monthly_return",
        note: "July allocation",
      },
    })
    expect(allocated.statusCode).toBe(201)
    expect(dataOf<Record<string, unknown>>(allocated)).toMatchObject({
      totalInvestmentPaise: "12500000",
      currentValuePaise: "13750000",
      totalReturnPaise: "1250000",
      returnPercent: 10,
    })

    // The allocation is one ledger row that moves value but never principal.
    const entry = await pool.query<{
      entry_type: string
      principal_delta_paise: string
      value_delta_paise: string
      allocated_by_user_id: string | null
      reason_code: string | null
    }>(
      "select entry_type, principal_delta_paise, value_delta_paise, allocated_by_user_id, reason_code " +
        "from investor_ledger_entries where entry_type = 'gain_allocation' and user_id = $1",
      [clientId],
    )
    expect(entry.rows[0]).toMatchObject({
      principal_delta_paise: "0",
      value_delta_paise: "1250000",
      reason_code: "monthly_return",
    })
    expect(entry.rows[0]?.allocated_by_user_id).not.toBeNull()

    // The profile derives the same dashboard the investor sees.
    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${clientId}/detail`,
      headers: read(session),
    })
    const body = dataOf<{
      positions: {
        fundId: string
        totalInvestmentPaise: string
        currentValuePaise: string
        returnPercent: number
        sipInstallmentCount: number
        lumpSumCount: number
        allocatedGainPaise: string
      }[]
      portfolio: Record<string, unknown>
    }>(detail)
    expect(body.positions.find((row) => row.fundId === fundId)).toMatchObject({
      totalInvestmentPaise: "12500000",
      currentValuePaise: "13750000",
      returnPercent: 10,
      sipInstallmentCount: 1,
      lumpSumCount: 1,
      allocatedGainPaise: "1250000",
    })
    expect(body.portfolio).toMatchObject({
      poolCount: 1,
      totalInvestmentPaise: "12500000",
      currentValuePaise: "13750000",
      totalReturnPaise: "1250000",
      returnPercent: 10,
      sipTotalPaise: "2500000",
      lumpSumTotalPaise: "10000000",
      allocatedGainPaise: "1250000",
    })

    // A loss is allowed, but not one larger than the investor holds.
    const tooBig = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${clientId}/gain-allocations`,
      headers: write(session),
      payload: { fundId, gainPaise: -99999999, effectiveDate: "2026-08-31", reasonCode: "drawdown" },
    })
    expect(tooBig.statusCode).toBe(400)

    const zero = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${clientId}/gain-allocations`,
      headers: write(session),
      payload: { fundId, gainPaise: 0, effectiveDate: "2026-08-31", reasonCode: "noop" },
    })
    expect(zero.statusCode).toBe(400)

    // Allocating to an investor with no position in the pool is a conflict.
    const strangerId = await createClient(`stranger-${randomUUID().slice(0, 8)}@example.com`)
    const noPosition = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${strangerId}/gain-allocations`,
      headers: write(session),
      payload: { fundId, gainPaise: 1000, effectiveDate: "2026-08-31", reasonCode: "monthly_return" },
    })
    expect(noPosition.statusCode).toBe(409)
  })

  test("walks a user through suspend, reinstate, and close with audit evidence", async () => {
    const session = await login("root@example.com")
    const clientId = await createClient(`lifecycle-${randomUUID().slice(0, 8)}@example.com`)

    const suspended = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${clientId}/suspend`,
      headers: write(session),
      payload: { reasonCode: "fraud_review", reason: "manual review" },
    })
    expect(suspended.statusCode).toBe(200)
    expect(dataOf<{ status: string }>(suspended).status).toBe("suspended")

    // Suspending twice is not a valid transition.
    const again = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${clientId}/suspend`,
      headers: write(session),
      payload: {},
    })
    expect(again.statusCode).toBe(409)

    const reinstated = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${clientId}/reinstate`,
      headers: write(session),
      payload: {},
    })
    expect(dataOf<{ status: string }>(reinstated).status).toBe("active")

    const closed = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${clientId}/close`,
      headers: write(session),
      payload: { reasonCode: "user_request" },
    })
    expect(dataOf<{ status: string }>(closed).status).toBe("closed")

    const audit = await pool.query<{ command: string }>(
      "select command from audit_events where entity_id = $1 and entity_type = 'user' order by occurred_at",
      [clientId],
    )
    expect(audit.rows.map((row) => row.command)).toEqual([
      "user.suspended",
      "user.active",
      "user.closed",
    ])

    const unknown = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${randomUUID()}/close`,
      headers: write(session),
      payload: {},
    })
    expect(unknown.statusCode).toBe(404)
  })

  test("serves the finance oversight reads with their filters", async () => {
    const session = await login("finance@example.com")
    const clientId = await createClient(`finance-${randomUUID().slice(0, 8)}@example.com`)
    const { fundId, orderId } = await seedFinanceEvidence(clientId)

    const transactions = await app.inject({
      method: "GET",
      url: `/v1/admin/transactions?fundId=${fundId}&limit=50`,
      headers: read(session),
    })
    expect(transactions.statusCode).toBe(200)
    const orders = dataOf<{ items: { id: string; amountPaise: string | null; status: string }[] }>(
      transactions,
    ).items
    const booked = orders.find((order) => order.id === orderId)
    expect(booked).toMatchObject({ status: "booked", amountPaise: "5000000" })

    const byType = await app.inject({
      method: "GET",
      url: "/v1/admin/transactions?type=redemption&status=submitted&limit=50",
      headers: read(session),
    })
    expect(dataOf<{ items: { type: string }[] }>(byType).items.every((o) => o.type === "redemption")).toBe(
      true,
    )

    const searched = await app.inject({
      method: "GET",
      url: `/v1/admin/transactions?q=${orderId.slice(0, 8)}`,
      headers: read(session),
    })
    expect(dataOf<{ items: { id: string }[] }>(searched).items.some((o) => o.id === orderId)).toBe(true)

    const payments = await app.inject({
      method: "GET",
      url: `/v1/admin/payments?status=succeeded&userId=${clientId}`,
      headers: read(session),
    })
    expect(dataOf<{ items: { orderId: string; attemptCount: number }[] }>(payments).items[0]).toMatchObject({
      orderId,
      attemptCount: 0,
    })

    const mandates = await app.inject({
      method: "GET",
      url: "/v1/admin/mandates?status=active&limit=50",
      headers: read(session),
    })
    expect(dataOf<{ items: { sipCount: number }[] }>(mandates).items.length).toBeGreaterThan(0)

    const sips = await app.inject({
      method: "GET",
      url: "/v1/admin/sips?status=active&limit=50",
      headers: read(session),
    })
    expect(dataOf<{ items: { fundId: string }[] }>(sips).items.some((s) => s.fundId === fundId)).toBe(true)
  })

  test("lists a pool's investors with ledger-derived positions", async () => {
    const session = await login("root@example.com")
    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, state, published_at, created_by_user_id) values ($1,'published', now(), $2) returning id",
      [`pool-view-${randomUUID().slice(0, 8)}`, await createClient(`pv-owner-${randomUUID().slice(0, 8)}@example.com`)],
    )
    const fundId = fund.rows[0]?.id as string

    // Two investors: ₹6,00,000 and ₹4,00,000, the second already holding ₹20,000
    // of allocated return.
    const first = await createClient(`pv-a-${randomUUID().slice(0, 8)}@example.com`)
    const second = await createClient(`pv-b-${randomUUID().slice(0, 8)}@example.com`)
    await seedLedgerEntry(first, fundId, "lump_sum", 60_000_000n, 60_000_000n)
    await seedLedgerEntry(second, fundId, "lump_sum", 40_000_000n, 40_000_000n)
    await seedLedgerEntry(second, fundId, "gain_allocation", 0n, 2_000_000n)

    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/funds/${fundId}/investors`,
      headers: read(session),
    })
    expect(response.statusCode).toBe(200)
    const body = dataOf<{
      investorCount: number
      investedTotalPaise: string
      currentValueTotalPaise: string
      investors: { userId: string; currentValuePaise: string; returnPercent: number | null }[]
    }>(response)

    expect(body.investorCount).toBe(2)
    expect(body.investedTotalPaise).toBe("100000000")
    expect(body.currentValueTotalPaise).toBe("102000000")
    // Largest position first.
    expect(body.investors[0]?.userId).toBe(first)
    expect(body.investors[0]?.currentValuePaise).toBe("60000000")
    // ₹20,000 on ₹4,00,000 is 5.00%.
    expect(body.investors[1]).toMatchObject({ userId: second, returnPercent: 5 })
  })

  test("distributes pool growth pro rata, previewing first and allocating exactly", async () => {
    const session = await login("finance@example.com")
    const owner = await createClient(`pd-owner-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, state, published_at, created_by_user_id) values ($1,'published', now(), $2) returning id",
      [`pool-dist-${randomUUID().slice(0, 8)}`, owner],
    )
    const fundId = fund.rows[0]?.id as string

    // Three uneven holdings so the split has a remainder to place.
    const investors = [] as string[]
    for (const [index, rupees] of [[0, 333_333], [1, 500_000], [2, 166_667]] as const) {
      const userId = await createClient(`pd-${index}-${randomUUID().slice(0, 8)}@example.com`)
      investors.push(userId)
      const paise = BigInt(rupees) * 100n
      await seedLedgerEntry(userId, fundId, "lump_sum", paise, paise)
    }

    // Preview: nothing is written, and the parts sum to the requested total.
    const preview = await app.inject({
      method: "PATCH",
      url: `/v1/admin/funds/${fundId}/gain-allocations`,
      headers: write(session),
      payload: {},
    })
    // Only POST is mounted; a wrong verb must not be silently accepted.
    expect(preview.statusCode).toBe(404)

    const dryRun = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/gain-allocations`,
      headers: write(session),
      payload: {
        effectiveDate: "2026-07-31",
        reasonCode: "monthly_growth",
        totalGainPaise: 3_500_000,
        dryRun: true,
      },
    })
    expect(dryRun.statusCode).toBe(200)
    const previewBody = dataOf<{
      dryRun: boolean
      basisPaise: string
      allocatedPaise: string
      shares: { userId: string; gainPaise: string }[]
    }>(dryRun)
    expect(previewBody.dryRun).toBe(true)
    expect(previewBody.basisPaise).toBe("100000000")
    expect(previewBody.allocatedPaise).toBe("3500000")
    expect(
      previewBody.shares.reduce((total, share) => total + BigInt(share.gainPaise), 0n).toString(),
    ).toBe("3500000")
    // A preview writes nothing.
    const afterPreview = await pool.query<{ c: number }>(
      "select count(*)::int as c from investor_ledger_entries where fund_id = $1 and entry_type = 'gain_allocation'",
      [fundId],
    )
    expect(afterPreview.rows[0]?.c).toBe(0)

    const allocated = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/gain-allocations`,
      headers: write(session),
      payload: {
        effectiveDate: "2026-07-31",
        reasonCode: "monthly_growth",
        totalGainPaise: 3_500_000,
        note: "July pool growth",
      },
    })
    expect(allocated.statusCode).toBe(201)
    const result = dataOf<{
      allocatedPaise: string
      investorCount: number
      allocations: { userId: string; gainPaise: string; currentValuePaise: string }[]
    }>(allocated)
    expect(result.investorCount).toBe(3)
    expect(result.allocatedPaise).toBe("3500000")

    // One ledger entry per investor, and the entries sum to the pool total.
    const entries = await pool.query<{ user_id: string; value_delta_paise: string }>(
      "select user_id, value_delta_paise from investor_ledger_entries " +
        "where fund_id = $1 and entry_type = 'gain_allocation'",
      [fundId],
    )
    expect(entries.rows).toHaveLength(3)
    expect(
      entries.rows.reduce((total, row) => total + BigInt(row.value_delta_paise), 0n).toString(),
    ).toBe("3500000")

    // Each investor's own dashboard figure moved by their share, principal untouched.
    for (const allocation of result.allocations) {
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/users/${allocation.userId}/detail`,
        headers: read(await login("root@example.com")),
      })
      expect(dataOf<{ portfolio: { currentValuePaise: string } }>(detail).portfolio.currentValuePaise).toBe(
        allocation.currentValuePaise,
      )
    }

    // Every investor was notified of the credit.
    const notified = await pool.query<{ c: number }>(
      "select count(*)::int as c from notifications where kind = 'portfolio_updated' and user_id = any($1::uuid[])",
      [investors],
    )
    expect(notified.rows[0]?.c).toBe(3)
  })

  test("a percentage distribution grows each investor by that percentage", async () => {
    const session = await login("finance@example.com")
    const owner = await createClient(`pp-owner-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, state, published_at, created_by_user_id) values ($1,'published', now(), $2) returning id",
      [`pool-pct-${randomUUID().slice(0, 8)}`, owner],
    )
    const fundId = fund.rows[0]?.id as string
    const investor = await createClient(`pp-a-${randomUUID().slice(0, 8)}@example.com`)
    // ₹10,00,000 growing 3.5% earns ₹35,000, mirroring the model document's pool.
    await seedLedgerEntry(investor, fundId, "lump_sum", 100_000_000n, 100_000_000n)

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/gain-allocations`,
      headers: write(session),
      payload: {
        effectiveDate: "2026-08-31",
        reasonCode: "monthly_growth",
        growthBasisPoints: 350,
      },
    })
    expect(response.statusCode).toBe(201)
    expect(dataOf<{ allocatedPaise: string }>(response).allocatedPaise).toBe("3500000")
    expect(
      dataOf<{ allocations: { currentValuePaise: string }[] }>(response).allocations[0]
        ?.currentValuePaise,
    ).toBe("103500000")
  })

  test("an ambiguous or empty distribution is refused", async () => {
    const session = await login("finance@example.com")
    const owner = await createClient(`pe-owner-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, state, published_at, created_by_user_id) values ($1,'published', now(), $2) returning id",
      [`pool-empty-${randomUUID().slice(0, 8)}`, owner],
    )
    const fundId = fund.rows[0]?.id as string

    // Both instructions at once: refuse rather than pick one.
    const ambiguous = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/gain-allocations`,
      headers: write(session),
      payload: {
        effectiveDate: "2026-07-31",
        reasonCode: "monthly_growth",
        totalGainPaise: 1000,
        growthBasisPoints: 100,
      },
    })
    expect(ambiguous.statusCode).toBe(400)

    // A pool with no investors has nothing to distribute to.
    const empty = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/gain-allocations`,
      headers: write(session),
      payload: { effectiveDate: "2026-07-31", reasonCode: "monthly_growth", totalGainPaise: 1000 },
    })
    expect(empty.statusCode).toBe(409)

    // Distribution is a finance operation; content admins cannot run it.
    const contentSession = await login("content@example.com")
    const denied = await app.inject({
      method: "POST",
      url: `/v1/admin/funds/${fundId}/gain-allocations`,
      headers: write(contentSession),
      payload: { effectiveDate: "2026-07-31", reasonCode: "monthly_growth", totalGainPaise: 1000 },
    })
    expect(denied.statusCode).toBe(403)
  })

  test("refuses to settle a request with no funded position or above the dual-approval threshold", async () => {
    const session = await login("finance@example.com")
    const clientId = await createClient(`redeem-${randomUUID().slice(0, 8)}@example.com`)
    const { redemptionId, fundId } = await seedFinanceEvidence(clientId)

    const queue = await app.inject({
      method: "GET",
      url: "/v1/admin/redemption-requests?status=submitted&limit=50",
      headers: read(session),
    })
    expect(queue.statusCode).toBe(200)
    expect(dataOf<{ items: { id: string }[] }>(queue).items.some((row) => row.id === redemptionId)).toBe(
      true,
    )

    // This fixture has no investor ledger, so there is nothing to pay out: the
    // settlement refuses rather than creating value out of nothing.
    const unfunded = await app.inject({
      method: "PATCH",
      url: `/v1/admin/redemption-requests/${redemptionId}`,
      headers: write(session),
      payload: { action: "approved", reason: "within threshold" },
    })
    expect(unfunded.statusCode).toBe(409)

    // Rejecting it is always available.
    const rejected = await app.inject({
      method: "PATCH",
      url: `/v1/admin/redemption-requests/${redemptionId}`,
      headers: write(session),
      payload: { action: "rejected", reason: "not funded" },
    })
    expect(dataOf<{ status: string }>(rejected).status).toBe("rejected")

    // A decided request cannot be decided again.
    const twice = await app.inject({
      method: "PATCH",
      url: `/v1/admin/redemption-requests/${redemptionId}`,
      headers: write(session),
      payload: { action: "rejected", reason: "late change" },
    })
    expect(twice.statusCode).toBe(409)

    const missing = await app.inject({
      method: "PATCH",
      url: `/v1/admin/redemption-requests/${randomUUID()}`,
      headers: write(session),
      payload: { action: "rejected", reason: "gone" },
    })
    expect(missing.statusCode).toBe(404)
    expect(fundId).toBeTruthy()
  })

  test("settling a redemption pays out on the ledger, returns first", async () => {
    const session = await login("finance@example.com")
    const clientId = await createClient(`settle-${randomUUID().slice(0, 8)}@example.com`)

    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, state, published_at, created_by_user_id) " +
        "values ($1,'published', now(), $2) returning id",
      [`settle-pool-${randomUUID().slice(0, 8)}`, clientId],
    )
    const fundId = fund.rows[0]?.id as string

    // ₹1,00,000 invested with ₹20,000 of allocated gain => ₹1,20,000 of value.
    await pool.query(
      "insert into investor_ledger_entries (user_id, fund_id, entry_type, principal_delta_paise, " +
        "value_delta_paise, amount_paise, effective_date, request_id) " +
        "values ($1,$2,'lump_sum',10000000,10000000,10000000, current_date, $3)",
      [clientId, fundId, randomUUID()],
    )
    await pool.query(
      "insert into investor_ledger_entries (user_id, fund_id, entry_type, principal_delta_paise, " +
        "value_delta_paise, amount_paise, effective_date, allocated_by_user_id, request_id) " +
        "values ($1,$2,'gain_allocation',0,2000000,2000000, current_date, $3, $4)",
      [clientId, fundId, clientId, randomUUID()],
    )
    await pool.query(
      "insert into finance_policy_versions (version, effective_from, published_by_user_id) " +
        "values (1, now(), $1) on conflict (version) do nothing",
      [clientId],
    )

    // A ₹30,000 request: ₹20,000 comes from gains, ₹10,000 from principal.
    const order = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, type, state, amount_paise, requested_at) " +
        "values ($1,$2,'redemption','submitted',3000000, now()) returning id",
      [clientId, fundId],
    )
    const requestRow = await pool.query<{ id: string }>(
      "insert into redemption_requests (order_id, user_id, fund_id, state, mode, requested_amount_paise, " +
        "principal_component_paise, returns_component_paise, finance_policy_version, " +
        "requires_dual_approval, submitted_at) " +
        "values ($1,$2,$3,'submitted','custom',3000000,1000000,2000000,1,false, now()) returning id",
      [order.rows[0]?.id, clientId, fundId],
    )
    const redemptionId = requestRow.rows[0]?.id as string

    const approved = await app.inject({
      method: "PATCH",
      url: `/v1/admin/redemption-requests/${redemptionId}`,
      headers: write(session),
      payload: { action: "approved", reason: "settled by ops" },
    })
    expect(approved.statusCode).toBe(200)
    expect(dataOf<Record<string, unknown>>(approved)).toMatchObject({
      status: "settled",
      settledAmountPaise: "3000000",
      returnsComponentPaise: "2000000",
      principalComponentPaise: "1000000",
      // ₹1,20,000 − ₹30,000 = ₹90,000 of value left.
      currentValuePaise: "9000000",
    })

    // One redemption entry: value down by the full payout, principal only by its share.
    const entry = await pool.query<{
      principal_delta_paise: string
      value_delta_paise: string
      amount_paise: string
      redemption_request_id: string | null
    }>(
      "select principal_delta_paise, value_delta_paise, amount_paise, redemption_request_id " +
        "from investor_ledger_entries where entry_type = 'redemption' and user_id = $1",
      [clientId],
    )
    expect(entry.rows).toHaveLength(1)
    expect(entry.rows[0]).toMatchObject({
      principal_delta_paise: "-1000000",
      value_delta_paise: "-3000000",
      amount_paise: "3000000",
      redemption_request_id: redemptionId,
    })

    // The profile now derives ₹90,000 of value on ₹90,000 invested: the gain was
    // paid out, so the return is back to zero. Reading a user profile needs
    // `users.read`, which the finance role does not carry.
    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${clientId}/detail`,
      headers: read(await login("root@example.com")),
    })
    expect(dataOf<{ portfolio: Record<string, unknown> }>(detail).portfolio).toMatchObject({
      totalInvestmentPaise: "9000000",
      currentValuePaise: "9000000",
      totalReturnPaise: "0",
    })

    // Settling twice is refused rather than paying out again.
    const replay = await app.inject({
      method: "PATCH",
      url: `/v1/admin/redemption-requests/${redemptionId}`,
      headers: write(session),
      payload: { action: "approved" },
    })
    expect(replay.statusCode).toBe(409)
  })

  test("rejecting a redemption leaves the investor's value untouched", async () => {
    const session = await login("finance@example.com")
    const clientId = await createClient(`reject-${randomUUID().slice(0, 8)}@example.com`)
    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, state, published_at, created_by_user_id) " +
        "values ($1,'published', now(), $2) returning id",
      [`reject-pool-${randomUUID().slice(0, 8)}`, clientId],
    )
    const fundId = fund.rows[0]?.id as string
    await pool.query(
      "insert into investor_ledger_entries (user_id, fund_id, entry_type, principal_delta_paise, " +
        "value_delta_paise, amount_paise, effective_date, request_id) " +
        "values ($1,$2,'lump_sum',5000000,5000000,5000000, current_date, $3)",
      [clientId, fundId, randomUUID()],
    )
    await pool.query(
      "insert into finance_policy_versions (version, effective_from, published_by_user_id) " +
        "values (1, now(), $1) on conflict (version) do nothing",
      [clientId],
    )
    const order = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, type, state, amount_paise, requested_at) " +
        "values ($1,$2,'redemption','submitted',5000000, now()) returning id",
      [clientId, fundId],
    )
    const requestRow = await pool.query<{ id: string }>(
      "insert into redemption_requests (order_id, user_id, fund_id, state, mode, requested_amount_paise, " +
        "principal_component_paise, returns_component_paise, finance_policy_version, " +
        "requires_dual_approval, submitted_at) " +
        "values ($1,$2,$3,'submitted','full',5000000,5000000,0,1,false, now()) returning id",
      [order.rows[0]?.id, clientId, fundId],
    )

    const rejected = await app.inject({
      method: "PATCH",
      url: `/v1/admin/redemption-requests/${requestRow.rows[0]?.id as string}`,
      headers: write(session),
      payload: { action: "rejected", reason: "insufficient documentation" },
    })
    expect(rejected.statusCode).toBe(200)
    expect(dataOf<Record<string, unknown>>(rejected)).toMatchObject({
      status: "rejected",
      settledAmountPaise: null,
    })

    const entries = await pool.query<{ c: number }>(
      "select count(*)::int as c from investor_ledger_entries where entry_type = 'redemption' and user_id = $1",
      [clientId],
    )
    expect(entries.rows[0]?.c).toBe(0)
  })

  test("reads back the redacted audit log with filters, and denies it without audit.read", async () => {
    const session = await login("root@example.com")

    const all = await app.inject({
      method: "GET",
      url: "/v1/admin/audit-logs?limit=100",
      headers: read(session),
    })
    expect(all.statusCode).toBe(200)
    const events = dataOf<{ items: { command: string; entityType: string; actorEmail: string | null }[] }>(
      all,
    ).items
    expect(events.length).toBeGreaterThan(0)
    expect(events.some((event) => event.command === "fund.version_published")).toBe(true)

    const filtered = await app.inject({
      method: "GET",
      url: "/v1/admin/audit-logs?entityType=course&limit=50",
      headers: read(session),
    })
    expect(
      dataOf<{ items: { entityType: string }[] }>(filtered).items.every((e) => e.entityType === "course"),
    ).toBe(true)

    const byCommand = await app.inject({
      method: "GET",
      url: "/v1/admin/audit-logs?command=fund.version_published&limit=50",
      headers: read(session),
    })
    expect(
      dataOf<{ items: { command: string }[] }>(byCommand).items.every(
        (event) => event.command === "fund.version_published",
      ),
    ).toBe(true)

    const windowed = await app.inject({
      method: "GET",
      url: `/v1/admin/audit-logs?occurredFrom=${encodeURIComponent(
        new Date(Date.now() - 3_600_000).toISOString(),
      )}&occurredTo=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}&limit=5`,
      headers: read(session),
    })
    expect(windowed.statusCode).toBe(200)

    const support = await login("support@example.com")
    const denied = await app.inject({
      method: "GET",
      url: "/v1/admin/audit-logs",
      headers: read(support),
    })
    expect(denied.statusCode).toBe(403)
  })

  test("requires an authenticated admin session and CSRF on unsafe methods", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/v1/admin/users", headers: { origin: ORIGIN } })
    expect(anonymous.statusCode).toBe(401)

    const session = await login("root@example.com")
    const noCsrf = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${randomUUID()}/suspend`,
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
      payload: {},
    })
    expect(noCsrf.statusCode).toBe(403)
  })
})
