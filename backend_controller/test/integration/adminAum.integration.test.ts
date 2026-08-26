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
import { createClientCatalogRepository } from "../../src/repositories/clientCatalogRepository.js"
import { createFundAumRepository } from "../../src/repositories/fundAumRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createFixedWindowRateLimiter } from "../../src/http/rateLimit.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminAumRoutes, type AdminAumDeps } from "../../src/routes/adminAumRoutes.js"
import { registerAdminCatalogRoutes } from "../../src/routes/adminCatalogRoutes.js"
import { registerAdminFundGrowthPreviewRoutes } from "../../src/routes/adminFundGrowthPreviewRoutes.js"
import { registerClientCatalogRoutes } from "../../src/routes/clientCatalogRoutes.js"
import { createUncachedCache } from "../../src/cache/cache.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

let adminToken: string
let adminId: string
let supportToken: string
let clientToken: string

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const metaOf = (response: { json: () => unknown }): { idempotencyReplay?: boolean } =>
  (response.json() as { meta: { idempotencyReplay?: boolean } }).meta
const errorOf = (response: { json: () => unknown }): string =>
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

const seedFund = async (slug: string): Promise<string> => {
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, created_by_user_id) values ($1,'draft',$2) returning id",
    [slug, adminId],
  )
  return fund.rows[0]!.id
}

const snapshotCount = async (fundId: string): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    "select count(*)::text as count from fund_aum_snapshots where fund_id = $1",
    [fundId],
  )
  return Number(result.rows[0]!.count)
}

const batchCount = async (): Promise<number> => {
  const result = await pool.query<{ count: string }>("select count(*)::text as count from aum_growth_batches")
  return Number(result.rows[0]!.count)
}

const postAum = (
  url: string,
  token: string,
  payload: Record<string, unknown>,
  key?: string,
): Promise<unknown> =>
  app.inject({
    method: "POST",
    url,
    headers: { ...bearer(token), ...(key === undefined ? {} : { "idempotency-key": key }) },
    payload,
  })

interface Injected {
  statusCode: number
  json: () => unknown
}

const asInjected = (response: unknown): Injected => response as Injected

const initialize = (fundId: string, aumPaise: string, key: string, asOfDate = "2026-07-31") =>
  postAum(`/v1/admin/aum/funds/${fundId}/initialize`, adminToken, {
    aumPaise,
    asOfDate,
    reasonCode: "initial_publication",
  }, key).then(asInjected)

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
  const fundAumRepository = createFundAumRepository()
  const aumDeps: AdminAumDeps = {
    webAuth,
    unitOfWork,
    database,
    clock,
    config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000 },
    aumRepository: fundAumRepository,
    auditRepository,
    idempotencyRepository,
    rateLimiter: createFixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 10_000 }, clock),
  }

  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminAumRoutes(instance, aumDeps)
      registerAdminFundGrowthPreviewRoutes(instance, aumDeps)
      registerAdminCatalogRoutes(instance, {
        webAuth,
        unitOfWork,
        database,
        clock,
        config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000 },
        catalogRepository: createAdminCatalogRepository(),
        aumRepository: fundAumRepository,
        auditRepository,
        idempotencyRepository,
      })
      registerClientCatalogRoutes(instance, {
        accessTokenService,
        database,
        clock,
        cache: createUncachedCache(),
        config: { cursorKey: randomBytes(32), catalogTtlMs: 0 },
        clientCatalogRepository: createClientCatalogRepository(),
      })
    },
  })

  const admin = await makeUser(accessTokenService, "aum-admin@example.com")
  adminId = admin.userId
  adminToken = admin.token
  await grantRole(adminId, "finance")

  const support = await makeUser(accessTokenService, "aum-support@example.com")
  supportToken = support.token
  await grantRole(support.userId, "support")

  const client = await makeUser(accessTokenService, "aum-client@example.com")
  clientToken = client.token
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("initialize (integration)", () => {
  test("publishes the first absolute snapshot with a batch header and audit", async () => {
    const fundId = await seedFund("aum-init")
    const response = await initialize(fundId, "10000000", `init-${randomUUID()}`)
    expect(response.statusCode).toBe(201)
    const body = dataOf<{ snapshot: Record<string, unknown>; growthBatchId: string }>(response)
    expect(body.snapshot).toMatchObject({
      fundId,
      asOfDate: "2026-07-31",
      revision: 1,
      aumPaise: "10000000",
      reasonCode: "initial_publication",
    })

    const batch = await pool.query(
      "select scope, instruction_type, total_delta_paise::text as total from aum_growth_batches where id = $1",
      [body.growthBatchId],
    )
    expect(batch.rows[0]).toMatchObject({ scope: "individual", instruction_type: "amount", total: "10000000" })

    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where command = 'fund_aum.initialized' and entity_id = $1",
      [(body.snapshot as { id: string }).id],
    )
    expect(audit.rows[0]?.metadata).toMatchObject({ fundId, propagatedToClients: false })
  })

  test("rejects a negative amount, a missing key, and unknown funds", async () => {
    const fundId = await seedFund("aum-init-validation")

    const negative = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/initialize`, adminToken, {
      aumPaise: "-1",
      asOfDate: "2026-07-31",
      reasonCode: "initial_publication",
    }, `neg-${randomUUID()}`))
    expect(negative.statusCode).toBe(400)
    expect(errorOf(negative)).toBe("VALIDATION_FAILED")

    const noKey = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/initialize`, adminToken, {
      aumPaise: "100",
      asOfDate: "2026-07-31",
      reasonCode: "initial_publication",
    }))
    expect(noKey.statusCode).toBe(400)

    const unknown = await initialize(randomUUID(), "100", `unk-${randomUUID()}`)
    expect(unknown.statusCode).toBe(404)
  })

  test("requires aum.write", async () => {
    const fundId = await seedFund("aum-init-forbidden")
    const response = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/initialize`, supportToken, {
      aumPaise: "100",
      asOfDate: "2026-07-31",
      reasonCode: "initial_publication",
    }, `support-${randomUUID()}`))
    expect(response.statusCode).toBe(403)
    expect(errorOf(response)).toBe("AUTHORIZATION_DENIED")
  })

  test("replays the same key/body without a duplicate; a changed body conflicts", async () => {
    const fundId = await seedFund("aum-init-idem")
    const key = `replay-${randomUUID()}`
    const first = await initialize(fundId, "5000", key)
    expect(first.statusCode).toBe(201)
    const second = await initialize(fundId, "5000", key)
    expect(second.statusCode).toBe(201)
    expect(metaOf(second).idempotencyReplay).toBe(true)
    expect(dataOf<{ snapshot: { id: string } }>(second).snapshot.id).toBe(
      dataOf<{ snapshot: { id: string } }>(first).snapshot.id,
    )
    expect(await snapshotCount(fundId)).toBe(1)

    const changed = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/initialize`, adminToken, {
      aumPaise: "6000",
      asOfDate: "2026-07-31",
      reasonCode: "initial_publication",
    }, key))
    expect(changed.statusCode).toBe(409)
    expect(errorOf(changed)).toBe("IDEMPOTENCY_KEY_REUSED")
    expect(await snapshotCount(fundId)).toBe(1)
  })

  test("refuses a second publication: initialize is the first snapshot only", async () => {
    const fundId = await seedFund("aum-init-once")
    const first = await initialize(fundId, "100", `once-a-${randomUUID()}`)
    expect(first.statusCode).toBe(201)

    const again = await initialize(fundId, "200", `once-b-${randomUUID()}`, "2026-08-31")
    expect(again.statusCode).toBe(409)
    expect(errorOf(again)).toBe("STATE_CONFLICT")
    expect(await snapshotCount(fundId)).toBe(1)
  })

  test("rejects client-accounting fields outright (§9.5 strict schemas)", async () => {
    const fundId = await seedFund("aum-init-strict")
    for (const foreign of ["userId", "orderId", "paymentId", "contributionPaise", "redemptionPaise"]) {
      const response = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/initialize`, adminToken, {
        aumPaise: "100",
        asOfDate: "2026-07-31",
        reasonCode: "initial_publication",
        [foreign]: "1",
      }, `strict-${foreign}-${randomUUID()}`))
      expect(response.statusCode).toBe(400)
      expect(errorOf(response)).toBe("VALIDATION_FAILED")
    }
    expect(await snapshotCount(fundId)).toBe(0)
  })
})

describe("individual growth (integration)", () => {
  test("growth cannot be dated before the basis it grows from", async () => {
    const fundId = await seedFund("aum-grow-backdate")
    await initialize(fundId, "10000000", `bd0-${randomUUID()}`, "2026-07-31")

    const backdated = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthPaise: "500000",
      asOfDate: "2026-06-30",
      reasonCode: "manual_adjustment",
    }, `bd1-${randomUUID()}`))
    expect(backdated.statusCode).toBe(409)
    expect(errorOf(backdated)).toBe("STATE_CONFLICT")
    expect(await snapshotCount(fundId)).toBe(1)
  })

  test("amount and percentage growth compute from the latest snapshot", async () => {
    const fundId = await seedFund("aum-grow")
    await initialize(fundId, "10000000", `g0-${randomUUID()}`)

    const amount = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthPaise: "500000",
      asOfDate: "2026-08-15",
      reasonCode: "manual_adjustment",
    }, `g1-${randomUUID()}`))
    expect(amount.statusCode).toBe(201)
    expect(dataOf<{ snapshot: { aumPaise: string }; deltaPaise: string }>(amount)).toMatchObject({
      snapshot: { aumPaise: "10500000", asOfDate: "2026-08-15" },
      deltaPaise: "500000",
    })

    const percentage = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthBasisPoints: 250,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
    }, `g2-${randomUUID()}`))
    expect(percentage.statusCode).toBe(201)
    expect(dataOf<{ snapshot: { aumPaise: string }; deltaPaise: string }>(percentage)).toMatchObject({
      snapshot: { aumPaise: "10762500" },
      deltaPaise: "262500",
    })
  })

  test("a loss cannot make AUM negative and writes nothing", async () => {
    const fundId = await seedFund("aum-grow-negative")
    await initialize(fundId, "1000", `n0-${randomUUID()}`)
    const before = await snapshotCount(fundId)

    const response = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthPaise: "-1001",
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
    }, `n1-${randomUUID()}`))
    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toBe("STATE_CONFLICT")
    expect(await snapshotCount(fundId)).toBe(before)

    const toZero = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthBasisPoints: -10000,
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
    }, `n2-${randomUUID()}`))
    expect(toZero.statusCode).toBe(201)
    expect(dataOf<{ snapshot: { aumPaise: string } }>(toZero).snapshot.aumPaise).toBe("0")
  })

  test("requires exactly one instruction field and an existing basis", async () => {
    const fundId = await seedFund("aum-grow-xor")
    await initialize(fundId, "1000", `x0-${randomUUID()}`)

    const both = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthPaise: "10",
      growthBasisPoints: 10,
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
    }, `x1-${randomUUID()}`))
    expect(both.statusCode).toBe(400)

    const neither = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
    }, `x2-${randomUUID()}`))
    expect(neither.statusCode).toBe(400)

    const noBasis = await seedFund("aum-grow-nobasis")
    const response = asInjected(await postAum(`/v1/admin/aum/funds/${noBasis}/growth`, adminToken, {
      growthPaise: "10",
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
    }, `x3-${randomUUID()}`))
    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toBe("STATE_CONFLICT")
  })

  test("multiple publications on one date use increasing revisions", async () => {
    const fundId = await seedFund("aum-grow-revisions")
    await initialize(fundId, "1000", `r0-${randomUUID()}`)
    const second = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthPaise: "10",
      asOfDate: "2026-07-31",
      reasonCode: "same_day_adjustment",
    }, `r1-${randomUUID()}`))
    expect(second.statusCode).toBe(201)
    expect(dataOf<{ snapshot: { revision: number; aumPaise: string } }>(second).snapshot).toMatchObject({
      revision: 2,
      aumPaise: "1010",
    })
  })
})

describe("corrections and history (integration)", () => {
  test("a correction appends revision + 1, preserves the prior row, and never recalculates other dates", async () => {
    const fundId = await seedFund("aum-correct")
    const july = await initialize(fundId, "900000", `c0-${randomUUID()}`, "2026-07-31")
    const julyId = dataOf<{ snapshot: { id: string } }>(july).snapshot.id
    const august = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthPaise: "100000",
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
    }, `c1-${randomUUID()}`))
    expect(august.statusCode).toBe(201)

    const correction = asInjected(await postAum(`/v1/admin/aum/snapshots/${julyId}/corrections`, adminToken, {
      aumPaise: "950000",
      reasonCode: "typo_fix",
    }, `c2-${randomUUID()}`))
    expect(correction.statusCode).toBe(201)
    const corrected = dataOf<{ snapshot: Record<string, unknown> }>(correction).snapshot
    expect(corrected).toMatchObject({ revision: 2, aumPaise: "950000", asOfDate: "2026-07-31" })

    const rows = await pool.query<{ revision: number; aum_paise: string }>(
      "select revision, aum_paise::text from fund_aum_snapshots where fund_id = $1 and as_of_date = '2026-07-31' order by revision",
      [fundId],
    )
    expect(rows.rows).toEqual([
      { revision: 1, aum_paise: "900000" },
      { revision: 2, aum_paise: "950000" },
    ])

    const augustRows = await pool.query<{ aum_paise: string }>(
      "select aum_paise::text from fund_aum_snapshots where fund_id = $1 and as_of_date = '2026-08-31'",
      [fundId],
    )
    expect(augustRows.rows).toEqual([{ aum_paise: "1000000" }])
  })

  test("only the authoritative revision may be corrected; the date is never a caller input", async () => {
    const fundId = await seedFund("aum-correct-superseded")
    const first = await initialize(fundId, "100", `s0-${randomUUID()}`, "2026-07-31")
    const firstId = dataOf<{ snapshot: { id: string } }>(first).snapshot.id
    const second = asInjected(await postAum(`/v1/admin/aum/snapshots/${firstId}/corrections`, adminToken, {
      aumPaise: "200",
      reasonCode: "typo_fix",
    }, `s1-${randomUUID()}`))
    expect(second.statusCode).toBe(201)

    const stale = asInjected(await postAum(`/v1/admin/aum/snapshots/${firstId}/corrections`, adminToken, {
      aumPaise: "300",
      reasonCode: "typo_fix",
    }, `s2-${randomUUID()}`))
    expect(stale.statusCode).toBe(409)

    const secondId = dataOf<{ snapshot: { id: string } }>(second).snapshot.id
    const drift = asInjected(await postAum(`/v1/admin/aum/snapshots/${secondId}/corrections`, adminToken, {
      aumPaise: "300",
      asOfDate: "2026-08-01",
      reasonCode: "typo_fix",
    }, `s3-${randomUUID()}`))
    expect(drift.statusCode).toBe(400)
  })

  test("history returns snapshots latest-first in the §9.5 shape", async () => {
    const fundId = await seedFund("aum-history")
    await initialize(fundId, "100", `h0-${randomUUID()}`, "2026-06-30")
    const latest = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthPaise: "50",
      asOfDate: "2026-07-31",
      reasonCode: "monthly_mark",
    }, `h1-${randomUUID()}`))
    expect(latest.statusCode).toBe(201)

    const response = asInjected(await app.inject({
      method: "GET",
      url: `/v1/admin/aum/funds/${fundId}/history`,
      headers: bearer(adminToken),
    }))
    expect(response.statusCode).toBe(200)
    const items = dataOf<{ items: Record<string, unknown>[] }>(response).items
    expect(items.map((item) => [item.asOfDate, item.revision, item.aumPaise])).toEqual([
      ["2026-07-31", 1, "150"],
      ["2026-06-30", 1, "100"],
    ])
    expect(items[0]).toMatchObject({ reasonCode: "monthly_mark" })
    expect(typeof items[0]?.id).toBe("string")
    expect(typeof items[0]?.createdAt).toBe("string")
    expect(items[0]).toHaveProperty("note", null)
    expect(items[0]).not.toHaveProperty("publishedByUserId")
    expect(items[0]).not.toHaveProperty("requestId")

    const forbidden = asInjected(await app.inject({
      method: "GET",
      url: `/v1/admin/aum/funds/${fundId}/history`,
      headers: bearer(supportToken),
    }))
    expect(forbidden.statusCode).toBe(403)
  })
})

describe("collective growth (integration)", () => {
  const seedThreeFunds = async (): Promise<{ a: string; b: string; bare: string }> => {
    const a = await seedFund(`col-a-${randomUUID().slice(0, 8)}`)
    const b = await seedFund(`col-b-${randomUUID().slice(0, 8)}`)
    const bare = await seedFund(`col-bare-${randomUUID().slice(0, 8)}`)
    await initialize(a, "1000000", `ca-${randomUUID()}`)
    await initialize(b, "2000000", `cb-${randomUUID()}`)
    return { a, b, bare }
  }

  const plan = (payload: Record<string, unknown>) =>
    postAum("/v1/admin/aum/growth/collective/preview", adminToken, payload).then(asInjected)

  const commit = (payload: Record<string, unknown>, key: string) =>
    postAum("/v1/admin/aum/growth/collective", adminToken, payload, key).then(asInjected)

  test("the planning call computes each fund from its own basis and writes nothing", async () => {
    const { a, b } = await seedThreeFunds()
    const snapshotsBefore = await snapshotCount(a)
    const response = await plan({
      fundIds: [a, b],
      growthBasisPoints: 1000,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
    })
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ basisHash: string; items: Record<string, unknown>[] }>(response)
    expect(body.basisHash).toMatch(/^[0-9a-f]{64}$/u)
    const byFund = new Map(body.items.map((item) => [item.fundId, item]))
    expect(byFund.get(a)).toMatchObject({
      beforeAumPaise: "1000000",
      deltaPaise: "100000",
      afterAumPaise: "1100000",
    })
    expect(byFund.get(b)).toMatchObject({
      beforeAumPaise: "2000000",
      deltaPaise: "200000",
      afterAumPaise: "2200000",
    })
    expect(await snapshotCount(a)).toBe(snapshotsBefore)
  })

  test("commit writes one snapshot per fund under a shared batch, audited once", async () => {
    const { a, b } = await seedThreeFunds()
    const planned = await plan({
      fundIds: [a, b],
      growthBasisPoints: 1000,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
    })
    const { basisHash } = dataOf<{ basisHash: string }>(planned)

    const response = await commit({
      fundIds: [a, b],
      growthBasisPoints: 1000,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
      basisHash,
    }, `cc-${randomUUID()}`)
    expect(response.statusCode).toBe(201)
    const body = dataOf<{
      growthBatchId: string
      targetCount: number
      totalDeltaPaise: string
      items: { fundId: string; afterAumPaise: string }[]
    }>(response)
    expect(body.targetCount).toBe(2)
    expect(body.totalDeltaPaise).toBe("300000")
    expect(body.items.find((item) => item.fundId === a)?.afterAumPaise).toBe("1100000")
    expect(body.items.find((item) => item.fundId === b)?.afterAumPaise).toBe("2200000")

    const snapshots = await pool.query<{ count: string }>(
      "select count(*)::text as count from fund_aum_snapshots where aum_growth_batch_id = $1",
      [body.growthBatchId],
    )
    expect(Number(snapshots.rows[0]!.count)).toBe(2)

    const audits = await pool.query<{ count: string; metadata: Record<string, unknown> }>(
      "select count(*) over ()::text as count, metadata from audit_events where command = 'fund_aum.growth_collective' and entity_id = $1",
      [body.growthBatchId],
    )
    expect(audits.rows.length).toBe(1)
    expect(audits.rows[0]?.metadata).toMatchObject({ propagatedToClients: false, targetCount: 2 })
  })

  test("explicit deltas are preserved exactly and create no fund-to-fund dependency", async () => {
    const { a, b } = await seedThreeFunds()
    const planned = await plan({
      items: [
        { fundId: a, growthPaise: "-5" },
        { fundId: b, growthPaise: "1234567" },
      ],
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
    })
    expect(planned.statusCode).toBe(200)
    const { basisHash } = dataOf<{ basisHash: string }>(planned)
    const response = await commit({
      items: [
        { fundId: a, growthPaise: "-5" },
        { fundId: b, growthPaise: "1234567" },
      ],
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
      basisHash,
    }, `cd-${randomUUID()}`)
    expect(response.statusCode).toBe(201)
    const body = dataOf<{ totalDeltaPaise: string; items: { fundId: string; deltaPaise: string; afterAumPaise: string }[] }>(response)
    expect(body.totalDeltaPaise).toBe("1234562")
    expect(body.items.find((item) => item.fundId === a)).toMatchObject({ deltaPaise: "-5", afterAumPaise: "999995" })
    expect(body.items.find((item) => item.fundId === b)).toMatchObject({ deltaPaise: "1234567", afterAumPaise: "3234567" })
  })

  test("a stale hash returns 409 with zero writes", async () => {
    const { a, b } = await seedThreeFunds()
    const planned = await plan({
      fundIds: [a, b],
      growthBasisPoints: 100,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
    })
    const { basisHash } = dataOf<{ basisHash: string }>(planned)

    const moved = asInjected(await postAum(`/v1/admin/aum/funds/${a}/growth`, adminToken, {
      growthPaise: "1",
      asOfDate: "2026-08-15",
      reasonCode: "manual_adjustment",
    }, `mv-${randomUUID()}`))
    expect(moved.statusCode).toBe(201)

    const snapshotsBefore = (await snapshotCount(a)) + (await snapshotCount(b))
    const batchesBefore = await batchCount()
    const response = await commit({
      fundIds: [a, b],
      growthBasisPoints: 100,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
      basisHash,
    }, `cs-${randomUUID()}`)
    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toBe("STATE_CONFLICT")
    expect((await snapshotCount(a)) + (await snapshotCount(b))).toBe(snapshotsBefore)
    expect(await batchCount()).toBe(batchesBefore)
  })

  test("one invalid target rolls back the whole batch", async () => {
    const { a, b } = await seedThreeFunds()
    const planned = await plan({
      items: [
        { fundId: a, growthPaise: "10" },
        { fundId: b, growthPaise: "-2000001" },
      ],
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
    })
    expect(planned.statusCode).toBe(409)

    const c = await seedFund(`col-c-${randomUUID().slice(0, 8)}`)
    const d = await seedFund(`col-d-${randomUUID().slice(0, 8)}`)
    await initialize(c, "1000", `ci-${randomUUID()}`)
    await initialize(d, "1000", `di-${randomUUID()}`)
    const plannedCd = await plan({
      items: [
        { fundId: c, growthPaise: "10" },
        { fundId: d, growthPaise: "-1000" },
      ],
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
    })
    const { basisHash } = dataOf<{ basisHash: string }>(plannedCd)
    const snapshotsBefore = (await snapshotCount(c)) + (await snapshotCount(d))
    const batchesBefore = await batchCount()
    const response = await commit({
      items: [
        { fundId: c, growthPaise: "10" },
        { fundId: d, growthPaise: "-1001" },
      ],
      asOfDate: "2026-08-31",
      reasonCode: "manual_adjustment",
      basisHash,
    }, `cb-${randomUUID()}`)
    expect(response.statusCode).toBe(409)
    expect((await snapshotCount(c)) + (await snapshotCount(d))).toBe(snapshotsBefore)
    expect(await batchCount()).toBe(batchesBefore)
  })

  test("a fund without any basis rejects the batch", async () => {
    const { a, bare } = await seedThreeFunds()
    const response = await plan({
      fundIds: [a, bare],
      growthBasisPoints: 100,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
    })
    expect(response.statusCode).toBe(409)
  })

  test("caps the batch at 100 funds and rejects foreign fields", async () => {
    const tooMany = await plan({
      fundIds: Array.from({ length: 101 }, () => randomUUID()),
      growthBasisPoints: 100,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
    })
    expect(tooMany.statusCode).toBe(400)

    const { a } = await seedThreeFunds()
    const foreign = await plan({
      fundIds: [a],
      growthBasisPoints: 100,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
      userId: randomUUID(),
    })
    expect(foreign.statusCode).toBe(400)
  })

  test("commit replay creates no duplicate snapshots", async () => {
    const { a, b } = await seedThreeFunds()
    const planned = await plan({
      fundIds: [a, b],
      growthBasisPoints: 50,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
    })
    const { basisHash } = dataOf<{ basisHash: string }>(planned)
    const payload = {
      fundIds: [a, b],
      growthBasisPoints: 50,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
      basisHash,
    }
    const key = `cr-${randomUUID()}`
    const first = await commit(payload, key)
    expect(first.statusCode).toBe(201)
    const second = await commit(payload, key)
    expect(second.statusCode).toBe(201)
    expect(metaOf(second).idempotencyReplay).toBe(true)
    expect(dataOf<{ growthBatchId: string }>(second).growthBatchId).toBe(
      dataOf<{ growthBatchId: string }>(first).growthBatchId,
    )
    expect(await snapshotCount(a)).toBe(2)
    expect(await snapshotCount(b)).toBe(2)
  })

  test("client value accounting is untouched by AUM commands", async () => {
    const { a, b } = await seedThreeFunds()
    const before = await pool.query<{ count: string }>("select count(*)::text as count from client_value_entries")
    const planned = await plan({
      fundIds: [a, b],
      growthBasisPoints: 100,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
    })
    const { basisHash } = dataOf<{ basisHash: string }>(planned)
    const response = await commit({
      fundIds: [a, b],
      growthBasisPoints: 100,
      asOfDate: "2026-08-31",
      reasonCode: "monthly_mark",
      basisHash,
    }, `cv-${randomUUID()}`)
    expect(response.statusCode).toBe(201)
    const after = await pool.query<{ count: string }>("select count(*)::text as count from client_value_entries")
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count)
  })
})

describe("catalogue AUM projections (integration)", () => {
  test("admin fund detail and client fund size serve the latest authoritative snapshot", async () => {
    const fund = await pool.query<{ id: string }>(
      "insert into funds (slug, state, published_at, created_by_user_id) values ($1,'published', now(), $2) returning id",
      [`proj-${randomUUID().slice(0, 8)}`, adminId],
    )
    const fundId = fund.rows[0]!.id
    const disclosure = await pool.query<{ id: string }>(
      "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
        "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
      [fundId, randomBytes(32), adminId],
    )
    const version = await pool.query<{ id: string }>(
      "insert into fund_versions (fund_id, version, name, category, objective, risk_level, " +
        "minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, terms_sha256, created_by_user_id) " +
        "values ($1, 1, 'Projection Fund', 'hybrid', 'Balanced growth.', 'moderate', 0, 0, $2, $3, $4) returning id",
      [fundId, disclosure.rows[0]!.id, randomBytes(32), adminId],
    )
    await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, fundId])

    await initialize(fundId, "1000", `p0-${randomUUID()}`, "2026-06-30")
    const grown = asInjected(await postAum(`/v1/admin/aum/funds/${fundId}/growth`, adminToken, {
      growthPaise: "250",
      asOfDate: "2026-07-31",
      reasonCode: "monthly_mark",
    }, `p1-${randomUUID()}`))
    expect(grown.statusCode).toBe(201)
    const juneId = dataOf<{ items: { asOfDate: string; id: string }[] }>(
      asInjected(await app.inject({
        method: "GET",
        url: `/v1/admin/aum/funds/${fundId}/history`,
        headers: bearer(adminToken),
      })),
    ).items.find((item) => item.asOfDate === "2026-06-30")!.id
    const corrected = asInjected(await postAum(`/v1/admin/aum/snapshots/${juneId}/corrections`, adminToken, {
      aumPaise: "1100",
      reasonCode: "typo_fix",
    }, `p2-${randomUUID()}`))
    expect(corrected.statusCode).toBe(201)

    const adminDetail = asInjected(await app.inject({
      method: "GET",
      url: `/v1/admin/funds/${fundId}`,
      headers: bearer(adminToken),
    }))
    expect(adminDetail.statusCode).toBe(200)
    expect(dataOf<{ fund: { aum: unknown } }>(adminDetail).fund.aum).toMatchObject({
      aumPaise: "1250",
      asOfDate: "2026-07-31",
    })

    const clientList = asInjected(await app.inject({
      method: "GET",
      url: "/v1/client/funds",
      headers: bearer(clientToken),
    }))
    expect(clientList.statusCode).toBe(200)
    const listed = dataOf<{ items: { id: string; fundSize: unknown }[] }>(clientList).items.find(
      (item) => item.id === fundId,
    )
    expect(listed?.fundSize).toMatchObject({ aumPaise: "1250", asOfDate: "2026-07-31" })
    expect((listed?.fundSize as { lastUpdatedAt: string | null }).lastUpdatedAt).not.toBeNull()
  })
})
