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
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createAdminCatalogRepository } from "../../src/repositories/adminCatalogRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createFundAumRepository } from "../../src/repositories/fundAumRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminCatalogRoutes } from "../../src/routes/adminCatalogRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

let adminToken: string
let adminId: string
let readOnlyToken: string

interface Injected {
  statusCode: number
  json: () => unknown
}

const asInjected = (response: unknown): Injected => response as Injected
const dataOf = <T>(response: Injected): T => (response.json() as { data: T }).data
const metaOf = (response: Injected): { idempotencyReplay?: boolean; page?: unknown } =>
  (response.json() as { meta: { idempotencyReplay?: boolean; page?: unknown } }).meta
const errorOf = (response: Injected): string =>
  (response.json() as { error: { code: string } }).error.code
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

const makeUser = async (
  access: AccessTokenService,
  email: string,
): Promise<{ userId: string; token: string }> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1,$2,'Test Person','active', now()) returning id",
    [email, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
  )
  const userId = user.rows[0]!.id
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [userId],
  )
  const token = await access.sign({ sub: userId, sid: session.rows[0]!.id })
  return { userId, token }
}

const grantRole = async (userId: string, roleCode: string): Promise<void> => {
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
}

const TERMS = {
  name: "Compounding Equity",
  category: "equity",
  objective: "Long-horizon compounding.",
  riskLevel: "high",
  returnTier: "high",
  minimumSipPaise: 500000,
  minimumPurchasePaise: 2500000,
  minimumDurationMonths: 12,
  recommendedHoldingMonths: 60,
  disclosure: { title: "Risk disclosure", body: "Equity investments can lose value." },
} as const

const post = (url: string, token: string, payload: unknown, key?: string): Promise<Injected> =>
  app
    .inject({
      method: "POST",
      url,
      headers: { ...bearer(token), ...(key === undefined ? {} : { "idempotency-key": key }) },
      payload: payload as Record<string, unknown>,
    })
    .then(asInjected)

const patch = (url: string, token: string, payload: unknown, key?: string): Promise<Injected> =>
  app
    .inject({
      method: "PATCH",
      url,
      headers: { ...bearer(token), ...(key === undefined ? {} : { "idempotency-key": key }) },
      payload: payload as Record<string, unknown>,
    })
    .then(asInjected)

const del = (url: string, token: string, key?: string): Promise<Injected> =>
  app
    .inject({
      method: "DELETE",
      url,
      headers: { ...bearer(token), ...(key === undefined ? {} : { "idempotency-key": key }) },
    })
    .then(asInjected)

const get = (url: string, token: string): Promise<Injected> =>
  app.inject({ method: "GET", url, headers: bearer(token) }).then(asInjected)

const createFund = async (
  slug: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const response = await post(
    "/v1/admin/funds",
    adminToken,
    {
      slug,
      terms: { ...TERMS, ...overrides },
      openingAum: { aumPaise: "10000000", asOfDate: "2026-07-31", reasonCode: "initial_publication" },
    },
    `create-${randomUUID()}`,
  )
  expect(response.statusCode).toBe(201)
  return dataOf<{ fund: { id: string } }>(response).fund.id
}

const addStock = (fundId: string, stockName: string, key = `stock-${randomUUID()}`) =>
  post(
    `/v1/admin/funds/${fundId}/stocks`,
    adminToken,
    { stockName, quarterLabel: "Q1 FY27", weightPercent: 4.5, sortOrder: 1 },
    key,
  )

const auditCommands = async (entityId: string): Promise<string[]> => {
  const result = await pool.query<{ command: string }>(
    "select command from audit_events where entity_id = $1 order by occurred_at asc, command asc",
    [entityId],
  )
  return result.rows.map((row) => row.command)
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
  await runMigrations(pool, await loadMigrationFiles(directory))
  await runSeed(pool)

  const database = createDatabase(pool)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  const accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })

  const auditRepository = createAuditRepository()
  const idempotencyRepository = createIdempotencyRepository()
  const unitOfWork = createUnitOfWork(database)
  const clock = (): Date => new Date()
  const webAuth: WebAuthDeps = {
    userRepository: createUserRepository(),
    authSessionRepository: createAuthSessionRepository(),
    auditRepository,
    accessTokenService,
    database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rk1",
    csrfKeyVersion: "ck1",
    clock,
    config: { cookieSecure: false, originAllowlist: [] },
  }

  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminCatalogRoutes(instance, {
        webAuth,
        unitOfWork,
        database,
        clock,
        config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000 },
        catalogRepository: createAdminCatalogRepository(),
        aumRepository: createFundAumRepository(),
        auditRepository,
        idempotencyRepository,
      })
    },
  })

  const admin = await makeUser(accessTokenService, "fund-admin@example.com")
  adminId = admin.userId
  adminToken = admin.token
  await grantRole(adminId, "finance")

  const readOnly = await makeUser(accessTokenService, "fund-reader@example.com")
  readOnlyToken = readOnly.token
  await grantRole(readOnly.userId, "content")
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("create fund (integration)", () => {
  test("one request writes the fund, version 1, its disclosure and its opening AUM", async () => {
    const fundId = await createFund("atomic-create")

    const detail = await get(`/v1/admin/funds/${fundId}`, adminToken)
    expect(detail.statusCode).toBe(200)
    const body = dataOf<{
      fund: Record<string, unknown>
      versions: { version: number }[]
      disclosures: { body: string }[]
    }>(detail)
    expect(body.fund).toMatchObject({ slug: "atomic-create", status: "draft", currentVersion: 1 })
    expect(body.fund.aum).toMatchObject({ aumPaise: "10000000", asOfDate: "2026-07-31" })
    expect(body.versions).toHaveLength(1)
    expect(body.disclosures[0]!.body).toBe("Equity investments can lose value.")
    expect(await auditCommands(fundId)).toContain("fund.created")
  })

  test("a duplicate slug is rejected and leaves nothing behind", async () => {
    await createFund("slug-clash")
    const before = await pool.query<{ count: string }>(
      "select count(*)::text as count from funds where slug = 'slug-clash'",
    )
    const response = await post(
      "/v1/admin/funds",
      adminToken,
      {
        slug: "slug-clash",
        terms: TERMS,
        openingAum: { aumPaise: "1", asOfDate: "2026-07-31", reasonCode: "initial_publication" },
      },
      `create-${randomUUID()}`,
    )
    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toBe("STATE_CONFLICT")
    const after = await pool.query<{ count: string }>(
      "select count(*)::text as count from funds where slug = 'slug-clash'",
    )
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count)
  })

  test("a replayed key returns the original fund without creating a second one", async () => {
    const key = `create-${randomUUID()}`
    const payload = {
      slug: "replayed-create",
      terms: TERMS,
      openingAum: { aumPaise: "10000000", asOfDate: "2026-07-31", reasonCode: "initial_publication" },
    }
    const first = await post("/v1/admin/funds", adminToken, payload, key)
    const second = await post("/v1/admin/funds", adminToken, payload, key)
    expect(second.statusCode).toBe(201)
    expect(metaOf(second).idempotencyReplay).toBe(true)
    expect(dataOf<{ fund: { id: string } }>(second).fund.id)
      .toBe(dataOf<{ fund: { id: string } }>(first).fund.id)
    const count = await pool.query<{ count: string }>(
      "select count(*)::text as count from funds where slug = 'replayed-create'",
    )
    expect(count.rows[0]!.count).toBe("1")
  })

  test("the same key with a changed body conflicts instead of replaying", async () => {
    const key = `create-${randomUUID()}`
    const base = {
      slug: "hash-guard",
      terms: TERMS,
      openingAum: { aumPaise: "10000000", asOfDate: "2026-07-31", reasonCode: "initial_publication" },
    }
    expect((await post("/v1/admin/funds", adminToken, base, key)).statusCode).toBe(201)
    const changed = await post(
      "/v1/admin/funds",
      adminToken,
      { ...base, terms: { ...TERMS, minimumSipPaise: 999900 } },
      key,
    )
    expect(changed.statusCode).toBe(409)
    expect(errorOf(changed)).toBe("IDEMPOTENCY_KEY_REUSED")
  })

  test("creating a fund requires both funds.write and aum.write", async () => {
    const response = await post(
      "/v1/admin/funds",
      readOnlyToken,
      {
        slug: "forbidden-create",
        terms: TERMS,
        openingAum: { aumPaise: "1", asOfDate: "2026-07-31", reasonCode: "initial_publication" },
      },
      `create-${randomUUID()}`,
    )
    expect(response.statusCode).toBe(403)
  })
})

describe("versions (integration)", () => {
  test("publishing a version appends history and repoints the fund", async () => {
    const fundId = await createFund("versioned")
    const response = await post(
      `/v1/admin/funds/${fundId}/versions`,
      adminToken,
      { ...TERMS, name: "Compounding Equity II" },
      `version-${randomUUID()}`,
    )
    expect(response.statusCode).toBe(201)
    expect(dataOf<{ version: number }>(response).version).toBe(2)

    const detail = await get(`/v1/admin/funds/${fundId}`, adminToken)
    const body = dataOf<{ fund: { name: string; currentVersion: number }; versions: unknown[] }>(detail)
    expect(body.fund.currentVersion).toBe(2)
    expect(body.fund.name).toBe("Compounding Equity II")
    expect(body.versions).toHaveLength(2)
  })

  test("a blank disclosure body is refused by validation", async () => {
    const fundId = await createFund("blank-disclosure")
    const response = await post(
      `/v1/admin/funds/${fundId}/versions`,
      adminToken,
      { ...TERMS, disclosure: { title: "Risk", body: "" } },
      `version-${randomUUID()}`,
    )
    expect(response.statusCode).toBe(400)
    expect(errorOf(response)).toBe("VALIDATION_FAILED")
  })
})

describe("lifecycle (integration)", () => {
  test("draft publishes, pauses, republishes, then archives terminally", async () => {
    const fundId = await createFund("lifecycle")
    for (const status of ["published", "paused", "published", "archived"]) {
      const response = await patch(
        `/v1/admin/funds/${fundId}`,
        adminToken,
        { status },
        `life-${randomUUID()}`,
      )
      expect(response.statusCode, status).toBe(200)
      expect(dataOf<{ status: string }>(response).status).toBe(status)
    }
    for (const status of ["published", "paused", "archived"]) {
      const response = await patch(
        `/v1/admin/funds/${fundId}`,
        adminToken,
        { status },
        `life-${randomUUID()}`,
      )
      expect(response.statusCode, status).toBe(409)
      expect(errorOf(response)).toBe("STATE_CONFLICT")
    }
  })

  test("archiving a never-published draft is accepted by the schema", async () => {
    const fundId = await createFund("archive-draft")
    const response = await patch(
      `/v1/admin/funds/${fundId}`,
      adminToken,
      { status: "archived" },
      `life-${randomUUID()}`,
    )
    expect(response.statusCode).toBe(200)
    const row = await pool.query<{ state: string; published_at: string | null }>(
      "select state, published_at from funds where id = $1",
      [fundId],
    )
    expect(row.rows[0]).toMatchObject({ state: "archived", published_at: null })
  })

  test("an archived fund is still readable and keeps its list row", async () => {
    const fundId = await createFund("archive-visible")
    await patch(`/v1/admin/funds/${fundId}`, adminToken, { status: "archived" }, `life-${randomUUID()}`)
    expect((await get(`/v1/admin/funds/${fundId}`, adminToken)).statusCode).toBe(200)
    const list = await get("/v1/admin/funds?state=archived&limit=100", adminToken)
    const ids = dataOf<{ items: { id: string }[] }>(list).items.map((item) => item.id)
    expect(ids).toContain(fundId)
  })

  test("DELETE on a fund is not a registered route", async () => {
    const fundId = await createFund("no-delete")
    expect((await del(`/v1/admin/funds/${fundId}`, adminToken, `d-${randomUUID()}`)).statusCode)
      .toBe(404)
  })
})

describe("archived funds are immutable (integration)", () => {
  const archivedFundWithStock = async (slug: string): Promise<{ fundId: string; stockId: string }> => {
    const fundId = await createFund(slug)
    const added = await addStock(fundId, "Held Before Archive")
    const stockId = dataOf<{ stock: { id: string } }>(added).stock.id
    await patch(`/v1/admin/funds/${fundId}`, adminToken, { status: "archived" }, `life-${randomUUID()}`)
    return { fundId, stockId }
  }

  test("a new version cannot be published", async () => {
    const { fundId } = await archivedFundWithStock("archived-version")
    const response = await post(
      `/v1/admin/funds/${fundId}/versions`,
      adminToken,
      TERMS,
      `version-${randomUUID()}`,
    )
    expect(response.statusCode).toBe(409)
  })

  test("a stock cannot be added", async () => {
    const { fundId } = await archivedFundWithStock("archived-stock-add")
    expect((await addStock(fundId, "Too Late")).statusCode).toBe(409)
  })

  test("a stock cannot be edited", async () => {
    const { fundId, stockId } = await archivedFundWithStock("archived-stock-edit")
    const response = await patch(
      `/v1/admin/funds/${fundId}/stocks/${stockId}`,
      adminToken,
      { stockName: "Renamed", quarterLabel: "Q2 FY27", sortOrder: 1 },
      `stock-${randomUUID()}`,
    )
    expect(response.statusCode).toBe(409)
    const row = await pool.query<{ stock_name: string }>(
      "select stock_name from fund_stock_disclosures where id = $1",
      [stockId],
    )
    expect(row.rows[0]!.stock_name).toBe("Held Before Archive")
  })

  test("a stock cannot be marked exited", async () => {
    const { fundId, stockId } = await archivedFundWithStock("archived-stock-exit")
    const response = await del(
      `/v1/admin/funds/${fundId}/stocks/${stockId}`,
      adminToken,
      `stock-${randomUUID()}`,
    )
    expect(response.statusCode).toBe(409)
    const row = await pool.query<{ state: string }>(
      "select state from fund_stock_disclosures where id = $1",
      [stockId],
    )
    expect(row.rows[0]!.state).toBe("active")
  })
})

describe("stocks (integration)", () => {
  test("add, edit and exit move one row through its lifecycle", async () => {
    const fundId = await createFund("stock-lifecycle")
    const added = await addStock(fundId, "SJS Enterprises")
    expect(added.statusCode).toBe(201)
    const stockId = dataOf<{ stock: { id: string } }>(added).stock.id

    const edited = await patch(
      `/v1/admin/funds/${fundId}/stocks/${stockId}`,
      adminToken,
      { stockName: "SJS Enterprises Ltd", quarterLabel: "Q2 FY27", weightPercent: 5.25, sortOrder: 1 },
      `stock-${randomUUID()}`,
    )
    expect(edited.statusCode).toBe(200)
    expect(dataOf<{ stock: Record<string, unknown> }>(edited).stock).toMatchObject({
      stockName: "SJS Enterprises Ltd",
      quarterLabel: "Q2 FY27",
      weightPercent: "5.2500",
    })

    const exited = await del(
      `/v1/admin/funds/${fundId}/stocks/${stockId}`,
      adminToken,
      `stock-${randomUUID()}`,
    )
    expect(exited.statusCode).toBe(200)
    expect(dataOf<{ stock: { state: string } }>(exited).stock.state).toBe("exited")
    expect(await auditCommands(stockId)).toEqual([
      "fund.stock_added",
      "fund.stock_updated",
      "fund.stock_exited",
    ])
  })

  test("an already exited holding cannot be exited again or edited", async () => {
    const fundId = await createFund("stock-exit-once")
    const stockId = dataOf<{ stock: { id: string } }>(await addStock(fundId, "Gone")).stock.id
    await del(`/v1/admin/funds/${fundId}/stocks/${stockId}`, adminToken, `stock-${randomUUID()}`)

    const again = await del(
      `/v1/admin/funds/${fundId}/stocks/${stockId}`,
      adminToken,
      `stock-${randomUUID()}`,
    )
    expect(again.statusCode).toBe(409)
    const edit = await patch(
      `/v1/admin/funds/${fundId}/stocks/${stockId}`,
      adminToken,
      { stockName: "Gone Again", quarterLabel: "Q1 FY27", sortOrder: 1 },
      `stock-${randomUUID()}`,
    )
    expect(edit.statusCode).toBe(409)
  })

  test("an exited holding stops counting towards the catalogue stock count", async () => {
    const fundId = await createFund("stock-count")
    const keep = dataOf<{ stock: { id: string } }>(await addStock(fundId, "Kept")).stock.id
    const drop = dataOf<{ stock: { id: string } }>(await addStock(fundId, "Dropped")).stock.id
    expect(keep).not.toBe(drop)
    await del(`/v1/admin/funds/${fundId}/stocks/${drop}`, adminToken, `stock-${randomUUID()}`)
    const detail = await get(`/v1/admin/funds/${fundId}`, adminToken)
    expect(dataOf<{ fund: { stockCount: number } }>(detail).fund.stockCount).toBe(1)
  })

  test("a malformed quarter label is refused", async () => {
    const fundId = await createFund("stock-quarter")
    const response = await post(
      `/v1/admin/funds/${fundId}/stocks`,
      adminToken,
      { stockName: "Bad Quarter", quarterLabel: "Quarter One", sortOrder: 1 },
      `stock-${randomUUID()}`,
    )
    expect(response.statusCode).toBe(400)
  })

  test("a stock write on an unknown fund is a not-found, not a silent insert", async () => {
    const response = await addStock(randomUUID(), "Nowhere")
    expect(response.statusCode).toBe(404)
  })
})

describe("catalogue reads (integration)", () => {
  test("the summary counts every fund, not just the returned page", async () => {
    const first = await get("/v1/admin/funds?limit=1", adminToken)
    expect(first.statusCode).toBe(200)
    const body = dataOf<{
      items: unknown[]
      summary: { total: number; byState: Record<string, number> }
    }>(first)
    expect(body.items).toHaveLength(1)
    expect(body.summary.total).toBeGreaterThan(1)
    const summed = Object.values(body.summary.byState).reduce((total, count) => total + count, 0)
    expect(summed).toBe(body.summary.total)
  })

  test("the cursor walks the whole catalogue without repeating a fund", async () => {
    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 20; page += 1) {
      const url = `/v1/admin/funds?limit=2${cursor === null ? "" : `&after=${encodeURIComponent(cursor)}`}`
      const response = await get(url, adminToken)
      expect(response.statusCode).toBe(200)
      seen.push(...dataOf<{ items: { id: string }[] }>(response).items.map((item) => item.id))
      const meta = metaOf(response).page as { nextCursor: string | null; hasMore: boolean }
      if (!meta.hasMore || meta.nextCursor === null) break
      cursor = meta.nextCursor
    }
    expect(new Set(seen).size).toBe(seen.length)
    const total = dataOf<{ summary: { total: number } }>(await get("/v1/admin/funds?limit=1", adminToken))
      .summary.total
    expect(seen).toHaveLength(total)
  })

  test("the state filter and search narrow the catalogue", async () => {
    const fundId = await createFund("searchable-marker")
    await patch(`/v1/admin/funds/${fundId}`, adminToken, { status: "published" }, `life-${randomUUID()}`)

    const bySearch = await get("/v1/admin/funds?search=searchable-marker&limit=100", adminToken)
    expect(dataOf<{ items: { id: string }[] }>(bySearch).items.map((row) => row.id)).toEqual([fundId])

    const byState = await get("/v1/admin/funds?state=draft&limit=100", adminToken)
    const states = dataOf<{ items: { status: string }[] }>(byState).items.map((row) => row.status)
    expect(new Set(states)).toEqual(new Set(["draft"]))
  })

  test("a cursor minted for one filter is refused on another", async () => {
    const first = await get("/v1/admin/funds?limit=1", adminToken)
    const cursor = (metaOf(first).page as { nextCursor: string | null }).nextCursor
    expect(cursor).not.toBeNull()
    const response = await get(
      `/v1/admin/funds?limit=1&state=draft&after=${encodeURIComponent(cursor!)}`,
      adminToken,
    )
    expect(response.statusCode).toBe(400)
    expect(errorOf(response)).toBe("CURSOR_INVALID")
  })

  test("an unknown fund id is a not-found", async () => {
    expect((await get(`/v1/admin/funds/${randomUUID()}`, adminToken)).statusCode).toBe(404)
  })

  test("funds.read alone reads the catalogue but cannot change it", async () => {
    const fundId = await createFund("permission-split")
    expect((await get("/v1/admin/funds?limit=1", readOnlyToken)).statusCode).toBe(200)
    expect((await get(`/v1/admin/funds/${fundId}`, readOnlyToken)).statusCode).toBe(200)
    const lifecycle = await patch(
      `/v1/admin/funds/${fundId}`,
      readOnlyToken,
      { status: "published" },
      `life-${randomUUID()}`,
    )
    expect(lifecycle.statusCode).toBe(403)
    const version = await post(
      `/v1/admin/funds/${fundId}/versions`,
      readOnlyToken,
      TERMS,
      `version-${randomUUID()}`,
    )
    expect(version.statusCode).toBe(403)
  })
})
