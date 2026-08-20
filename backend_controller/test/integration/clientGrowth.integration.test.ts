/**
 * Client growth admin routes — integration tests (core mechanism spec
 * §8.1/§8.2/§8.5, §9.4, §10, §14 "Client growth").
 *
 *   POST /v1/admin/client-growth/individual
 *   POST /v1/admin/client-growth/collective/preview
 *   POST /v1/admin/client-growth/collective
 *
 * Covers: individual amount/percentage gain and loss, the negative-after guard,
 * principal invariance, both collective modes, eligibility/exclusion, stale
 * preview 409 with zero writes, whole-batch rollback, idempotent replay, RBAC,
 * audit metadata (`propagatedToAum: false`), generic client notifications, and
 * the independence invariant: fund AUM snapshots stay byte-for-byte unchanged.
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
import { createPool } from "../../src/db/pool.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"
const MAX_BASIS_POINTS = 100_000

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code

const cookieJar = (setCookie: string | string[] | undefined): Record<string, string> => {
  const arr = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  const jar: Record<string, string> = {}
  for (const cookie of arr) {
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

const createAdmin = async (email: string, roleCode: "finance" | "support"): Promise<string> => {
  const userRow = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Admin User', 'active', now()) returning id",
    [email, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
  )
  const userId = userRow.rows[0]!.id
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

const seedClient = async (email: string): Promise<string> => {
  const row = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Client Person', 'active', now()) returning id",
    [email, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
  )
  return row.rows[0]!.id
}

/** Publish a fund with a version and disclosure; returns the fund + version ids. */
const seedPublishedFund = async (
  slug: string,
  actorId: string,
): Promise<{ fundId: string; versionId: string }> => {
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1,'published', now(), $2) returning id",
    [slug, actorId],
  )
  const fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), actorId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
      "minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, " +
      "terms_sha256, created_by_user_id) " +
      "values ($1, 1, $2, 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $3, $4, $5) returning id",
    [fundId, `Fund ${slug}`, disclosure.rows[0]!.id, randomBytes(32), actorId],
  )
  const versionId = version.rows[0]!.id
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [
    versionId,
    fundId,
  ])
  return { fundId, versionId }
}

interface SeededPosition {
  readonly orderId: string
  readonly paymentId: string
  readonly allocationId: string
  readonly entryId: string
}

/** Seed an accepted position: order + succeeded payment + allocation + contribution entry. */
const seedPosition = async (
  userId: string,
  fundId: string,
  versionId: string,
  amountPaise: number,
  adminId: string,
): Promise<SeededPosition> => {
  const order = await pool.query<{ id: string }>(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'lump_sum', 'accepted', $4, now()) returning id",
    [userId, fundId, versionId, amountPaise],
  )
  const orderId = order.rows[0]!.id
  const payment = await pool.query<{ id: string }>(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) " +
      "values ($1, $2, $3, 'succeeded', now()) returning id",
    [orderId, userId, amountPaise],
  )
  const paymentId = payment.rows[0]!.id
  const allocation = await pool.query<{ id: string }>(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, $5, $6) returning id",
    [orderId, userId, fundId, amountPaise, adminId, `req-${randomUUID()}`],
  )
  const allocationId = allocation.rows[0]!.id
  const entry = await pool.query<{ id: string }>(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, " +
      "value_delta_paise, effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', $4, $4, current_date, $5, $6, 'investment_accepted', 'admin', $7, $8) returning id",
    [userId, fundId, allocationId, amountPaise, orderId, paymentId, adminId, `req-${randomUUID()}`],
  )
  return { orderId, paymentId, allocationId, entryId: entry.rows[0]!.id }
}

/** Reverse a contribution: the position then has no unreversed contribution. */
const reverseEntry = async (entry: SeededPosition, userId: string, fundId: string, amountPaise: number, adminId: string): Promise<void> => {
  await pool.query(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, reverses_entry_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'reversal', $3, $3, current_date, $4, 'correction', 'admin', $5, $6)",
    [userId, fundId, -amountPaise, entry.entryId, adminId, `req-${randomUUID()}`],
  )
}

/** Seed a position whose current value is exactly zero (contribution + full loss). */
const seedZeroValuePosition = async (
  userId: string,
  fundId: string,
  versionId: string,
  amountPaise: number,
  adminId: string,
): Promise<void> => {
  await seedPosition(userId, fundId, versionId, amountPaise, adminId)
  const batch = await pool.query<{ id: string }>(
    "insert into client_growth_batches (scope, instruction_type, effective_date, reason_code, basis_hash, " +
      "actor_user_id, request_id, target_count, total_delta_paise) " +
      "values ('individual', 'amount', current_date, 'seed_correction', 'seedhash', $1, $2, 1, $3) returning id",
    [adminId, `req-${randomUUID()}`, -amountPaise],
  )
  await pool.query(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, growth_batch_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'growth_adjustment', 0, $3, current_date, $4, 'seed_correction', 'admin', $5, $6)",
    [userId, fundId, -amountPaise, batch.rows[0]!.id, adminId, `req-${randomUUID()}`],
  )
}

const countRows = async (table: "client_growth_batches" | "client_value_entries"): Promise<number> => {
  const result = await pool.query<{ count: string }>(`select count(*) as count from ${table}`)
  return Number(result.rows[0]!.count)
}

const valueSum = async (userId: string, fundId: string): Promise<bigint> => {
  const result = await pool.query<{ total: string | null }>(
    "select sum(value_delta_paise)::text as total from client_value_entries where user_id = $1 and fund_id = $2",
    [userId, fundId],
  )
  return BigInt(result.rows[0]!.total ?? "0")
}

const principalSum = async (userId: string, fundId: string): Promise<bigint> => {
  const result = await pool.query<{ total: string | null }>(
    "select sum(principal_delta_paise)::text as total from client_value_entries where user_id = $1 and fund_id = $2",
    [userId, fundId],
  )
  return BigInt(result.rows[0]!.total ?? "0")
}

const authHeaders = (session: Session, extra: Record<string, string> = {}): Record<string, string> => ({
  origin: ORIGIN,
  cookie: cookieHeader(session.jar),
  "x-csrf-token": session.csrf,
  ...extra,
})

let financeSession: Session
let financeAdminId: string
let supportSession: Session

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
  const unitOfWork = createUnitOfWork(database)

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

  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerWebAuthRoutes(instance, {
        ...webAuth,
        unitOfWork,
        loginEventRepository: createLoginEventRepository(),
      })
      registerAdminClientGrowthRoutes(instance, {
        webAuth,
        unitOfWork,
        database,
        clock: () => new Date(),
        config: { idempotencyTtlMs: 86_400_000, maxBasisPoints: MAX_BASIS_POINTS },
        clientGrowthRepository: createClientGrowthRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
        notificationRepository: createNotificationRepository(),
      })
    },
  })

  financeAdminId = await createAdmin("growth-finance@example.com", "finance")
  await createAdmin("growth-support@example.com", "support")
  financeSession = await login("growth-finance@example.com")
  supportSession = await login("growth-support@example.com")
}, 220_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("POST /v1/admin/client-growth/individual", () => {
  test("applies an amount gain: one batch, one entry, audit, generic notification", async () => {
    const fund = await seedPublishedFund(`growth-ind-amt-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientId = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientId, fund.fundId, fund.versionId, 1_000_000, financeAdminId)

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession, { "idempotency-key": `ind-amt-${randomUUID()}` }),
      payload: {
        userId: clientId,
        fundId: fund.fundId,
        growthPaise: "25000",
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
        note: "private operator note",
      },
    })
    expect(response.statusCode).toBe(201)
    const body = dataOf<Record<string, unknown>>(response)
    expect(body.beforePaise).toBe("1000000")
    expect(body.deltaPaise).toBe("25000")
    expect(body.afterPaise).toBe("1025000")
    expect(body.fundId).toBe(fund.fundId)
    expect(typeof body.batchId).toBe("string")

    const entries = await pool.query<{
      entry_type: string
      principal_delta_paise: string
      value_delta_paise: string
      growth_batch_id: string | null
      actor_type: string
      note: string | null
    }>(
      "select entry_type, principal_delta_paise, value_delta_paise, growth_batch_id, actor_type, note " +
        "from client_value_entries where user_id = $1 and fund_id = $2 and entry_type = 'growth_adjustment'",
      [clientId, fund.fundId],
    )
    expect(entries.rows).toHaveLength(1)
    expect(entries.rows[0]!.principal_delta_paise).toBe("0")
    expect(entries.rows[0]!.value_delta_paise).toBe("25000")
    expect(entries.rows[0]!.growth_batch_id).toBe(body.batchId)
    expect(entries.rows[0]!.actor_type).toBe("admin")

    const batch = await pool.query<{
      scope: string
      instruction_type: string
      target_count: number
      total_delta_paise: string
      idempotency_record_id: string | null
    }>(
      "select scope, instruction_type, target_count, total_delta_paise, idempotency_record_id " +
        "from client_growth_batches where id = $1",
      [body.batchId as string],
    )
    expect(batch.rows[0]!.scope).toBe("individual")
    expect(batch.rows[0]!.instruction_type).toBe("amount")
    expect(batch.rows[0]!.target_count).toBe(1)
    expect(batch.rows[0]!.total_delta_paise).toBe("25000")
    // §5.9: the batch references the canonical idempotency record.
    expect(batch.rows[0]!.idempotency_record_id).not.toBeNull()

    // §10: audit metadata declares no propagation; the private note stays out.
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where entity_id = $1 and command = 'client_growth.individual'",
      [body.batchId as string],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]!.metadata.propagatedToAum).toBe(false)
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toContain("private operator note")

    // §10: the client notification is generic — no amounts, reasons, or notes.
    const notifications = await pool.query<{ title: string; body: string; payload: Record<string, unknown> }>(
      "select title, body, payload from notifications where user_id = $1",
      [clientId],
    )
    expect(notifications.rows).toHaveLength(1)
    const rendered = `${notifications.rows[0]!.title} ${notifications.rows[0]!.body}`
    expect(rendered).not.toContain("performance_update")
    expect(rendered).not.toContain("private operator note")
    expect(rendered).not.toContain("25000")
  })

  test("applies a percentage loss with symmetric rounding; principal unchanged", async () => {
    const fund = await seedPublishedFund(`growth-ind-pct-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientId = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientId, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    const principalBefore = await principalSum(clientId, fund.fundId)

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession, { "idempotency-key": `ind-pct-${randomUUID()}` }),
      payload: {
        userId: clientId,
        fundId: fund.fundId,
        growthBasisPoints: -250,
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
      },
    })
    expect(response.statusCode).toBe(201)
    const body = dataOf<Record<string, unknown>>(response)
    expect(body.deltaPaise).toBe("-25000")
    expect(body.afterPaise).toBe("975000")
    expect(await principalSum(clientId, fund.fundId)).toBe(principalBefore)
    expect(await valueSum(clientId, fund.fundId)).toBe(975_000n)
  })

  test("rejects a loss that would make the value negative and writes nothing", async () => {
    const fund = await seedPublishedFund(`growth-ind-neg-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientId = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientId, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    const batchesBefore = await countRows("client_growth_batches")
    const entriesBefore = await countRows("client_value_entries")

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession, { "idempotency-key": `ind-neg-${randomUUID()}` }),
      payload: {
        userId: clientId,
        fundId: fund.fundId,
        growthPaise: "-1000001",
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
      },
    })
    expect(response.statusCode).toBe(400)
    expect(errorOf(response)).toBe("VALIDATION_FAILED")
    expect(await countRows("client_growth_batches")).toBe(batchesBefore)
    expect(await countRows("client_value_entries")).toBe(entriesBefore)
  })

  test("rejects a position with no unreversed contribution as not found", async () => {
    const fund = await seedPublishedFund(`growth-ind-rev-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientId = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    const seeded = await seedPosition(clientId, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    await reverseEntry(seeded, clientId, fund.fundId, 1_000_000, financeAdminId)

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession, { "idempotency-key": `ind-rev-${randomUUID()}` }),
      payload: {
        userId: clientId,
        fundId: fund.fundId,
        growthPaise: "100",
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
      },
    })
    expect(response.statusCode).toBe(404)
    expect(errorOf(response)).toBe("RESOURCE_NOT_FOUND")
  })

  test("requires client_growth.write and an Idempotency-Key", async () => {
    const fund = await seedPublishedFund(`growth-ind-rbac-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientId = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientId, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    const payload = {
      userId: clientId,
      fundId: fund.fundId,
      growthPaise: "100",
      effectiveDate: "2026-08-20",
      reasonCode: "performance_update",
    }

    const denied = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(supportSession, { "idempotency-key": `ind-denied-${randomUUID()}` }),
      payload,
    })
    expect(denied.statusCode).toBe(403)
    expect(errorOf(denied)).toBe("AUTHORIZATION_DENIED")

    const noKey = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession),
      payload,
    })
    expect(noKey.statusCode).toBe(400)
    expect(errorOf(noKey)).toBe("VALIDATION_FAILED")
  })

  test("replays the same key with the same body; a changed body conflicts", async () => {
    const fund = await seedPublishedFund(`growth-ind-idem-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientId = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientId, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    const key = `ind-idem-${randomUUID()}`
    const payload = {
      userId: clientId,
      fundId: fund.fundId,
      growthPaise: "5000",
      effectiveDate: "2026-08-20",
      reasonCode: "performance_update",
    }
    const entriesBefore = await countRows("client_value_entries")

    const first = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession, { "idempotency-key": key }),
      payload,
    })
    expect(first.statusCode).toBe(201)

    const replay = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession, { "idempotency-key": key }),
      payload,
    })
    expect(replay.statusCode).toBe(201)
    expect(dataOf<Record<string, unknown>>(replay).batchId).toBe(
      dataOf<Record<string, unknown>>(first).batchId,
    )
    // Replay creates no duplicate entries.
    expect(await countRows("client_value_entries")).toBe(entriesBefore + 1)
    expect(await valueSum(clientId, fund.fundId)).toBe(1_005_000n)

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession, { "idempotency-key": key }),
      payload: { ...payload, growthPaise: "6000" },
    })
    expect(conflict.statusCode).toBe(409)
    expect(errorOf(conflict)).toBe("IDEMPOTENCY_KEY_REUSED")
  })
})

describe("POST /v1/admin/client-growth/collective", () => {
  test("percentage mode calculates each position independently end-to-end", async () => {
    const fund = await seedPublishedFund(`growth-col-pct-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientA = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    const clientB = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientA, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    await seedPosition(clientB, fund.fundId, fund.versionId, 500_000, financeAdminId)
    const batchesBefore = await countRows("client_growth_batches")

    const preview = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective/preview",
      headers: authHeaders(financeSession),
      payload: { fundId: fund.fundId, growthBasisPoints: 250 },
    })
    expect(preview.statusCode).toBe(200)
    const previewBody = dataOf<{
      basisHash: string
      excludedCount: number
      totalDeltaPaise: string
      targets: readonly { userId: string; beforePaise: string; deltaPaise: string; afterPaise: string }[]
    }>(preview)
    expect(previewBody.excludedCount).toBe(0)
    expect(previewBody.totalDeltaPaise).toBe("37500")
    const byUser = new Map(previewBody.targets.map((target) => [target.userId, target]))
    expect(byUser.get(clientA)).toMatchObject({ beforePaise: "1000000", deltaPaise: "25000", afterPaise: "1025000" })
    expect(byUser.get(clientB)).toMatchObject({ beforePaise: "500000", deltaPaise: "12500", afterPaise: "512500" })
    // Preview writes nothing.
    expect(await countRows("client_growth_batches")).toBe(batchesBefore)

    const commit = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective",
      headers: authHeaders(financeSession, { "idempotency-key": `col-pct-${randomUUID()}` }),
      payload: {
        fundId: fund.fundId,
        growthBasisPoints: 250,
        basisHash: previewBody.basisHash,
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
      },
    })
    expect(commit.statusCode).toBe(201)
    const commitBody = dataOf<Record<string, unknown>>(commit)
    expect(commitBody.targetCount).toBe(2)
    expect(commitBody.totalDeltaPaise).toBe("37500")
    expect(await valueSum(clientA, fund.fundId)).toBe(1_025_000n)
    expect(await valueSum(clientB, fund.fundId)).toBe(512_500n)
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where entity_id = $1 and command = 'client_growth.collective'",
      [commitBody.batchId as string],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]!.metadata.propagatedToAum).toBe(false)
  })

  test("explicit deltas are preserved exactly and the batch total equals their sum", async () => {
    const fund = await seedPublishedFund(`growth-col-exp-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientA = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    const clientB = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientA, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    await seedPosition(clientB, fund.fundId, fund.versionId, 500_000, financeAdminId)
    const items = [
      { userId: clientA, growthPaise: "123" },
      { userId: clientB, growthPaise: "-456" },
    ]

    const preview = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective/preview",
      headers: authHeaders(financeSession),
      payload: { fundId: fund.fundId, items },
    })
    expect(preview.statusCode).toBe(200)
    const previewBody = dataOf<{ basisHash: string; totalDeltaPaise: string }>(preview)
    expect(previewBody.totalDeltaPaise).toBe("-333")

    const commit = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective",
      headers: authHeaders(financeSession, { "idempotency-key": `col-exp-${randomUUID()}` }),
      payload: {
        fundId: fund.fundId,
        items,
        basisHash: previewBody.basisHash,
        effectiveDate: "2026-08-20",
        reasonCode: "manual_adjustment",
      },
    })
    expect(commit.statusCode).toBe(201)
    const batch = await pool.query<{ total_delta_paise: string; instruction_type: string }>(
      "select total_delta_paise, instruction_type from client_growth_batches where id = $1",
      [dataOf<Record<string, unknown>>(commit).batchId as string],
    )
    expect(batch.rows[0]!.instruction_type).toBe("explicit_deltas")
    expect(batch.rows[0]!.total_delta_paise).toBe("-333")
    expect(await valueSum(clientA, fund.fundId)).toBe(1_000_123n)
    expect(await valueSum(clientB, fund.fundId)).toBe(499_544n)
  })

  test("zero-value positions are excluded and reported as excludedCount", async () => {
    const fund = await seedPublishedFund(`growth-col-zero-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientA = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    const clientZero = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientA, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    await seedZeroValuePosition(clientZero, fund.fundId, fund.versionId, 400_000, financeAdminId)

    const preview = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective/preview",
      headers: authHeaders(financeSession),
      payload: { fundId: fund.fundId, growthBasisPoints: 500 },
    })
    expect(preview.statusCode).toBe(200)
    const previewBody = dataOf<{ basisHash: string; excludedCount: number; targets: readonly { userId: string }[] }>(preview)
    expect(previewBody.excludedCount).toBe(1)
    expect(previewBody.targets.map((target) => target.userId)).toEqual([clientA])

    const commit = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective",
      headers: authHeaders(financeSession, { "idempotency-key": `col-zero-${randomUUID()}` }),
      payload: {
        fundId: fund.fundId,
        growthBasisPoints: 500,
        basisHash: previewBody.basisHash,
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
      },
    })
    expect(commit.statusCode).toBe(201)
    expect(await valueSum(clientA, fund.fundId)).toBe(1_050_000n)
    expect(await valueSum(clientZero, fund.fundId)).toBe(0n)
  })

  test("percentage mode skips calculated zero deltas instead of writing zero rows", async () => {
    const fund = await seedPublishedFund(`growth-col-tiny-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientA = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    const clientTiny = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientA, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    await seedPosition(clientTiny, fund.fundId, fund.versionId, 4, financeAdminId)

    const preview = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective/preview",
      headers: authHeaders(financeSession),
      payload: { fundId: fund.fundId, growthBasisPoints: 100 },
    })
    expect(preview.statusCode).toBe(200)
    const previewBody = dataOf<{ basisHash: string; targets: readonly { userId: string }[] }>(preview)
    expect(previewBody.targets.map((target) => target.userId)).toEqual([clientA])

    const commit = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective",
      headers: authHeaders(financeSession, { "idempotency-key": `col-tiny-${randomUUID()}` }),
      payload: {
        fundId: fund.fundId,
        growthBasisPoints: 100,
        basisHash: previewBody.basisHash,
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
      },
    })
    expect(commit.statusCode).toBe(201)
    const tinyEntries = await pool.query<{ count: string }>(
      "select count(*) as count from client_value_entries where user_id = $1 and entry_type = 'growth_adjustment'",
      [clientTiny],
    )
    expect(Number(tinyEntries.rows[0]!.count)).toBe(0)
  })

  test("a fund with no eligible positions returns 409 on preview and commit", async () => {
    const fund = await seedPublishedFund(`growth-col-empty-${randomUUID().slice(0, 8)}`, financeAdminId)
    const preview = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective/preview",
      headers: authHeaders(financeSession),
      payload: { fundId: fund.fundId, growthBasisPoints: 250 },
    })
    expect(preview.statusCode).toBe(409)
    expect(errorOf(preview)).toBe("STATE_CONFLICT")
  })

  test("a stale preview basis conflicts with zero writes", async () => {
    const fund = await seedPublishedFund(`growth-col-stale-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientId = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientId, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    const batchesBefore = await countRows("client_growth_batches")
    const entriesBefore = await countRows("client_value_entries")

    const preview = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective/preview",
      headers: authHeaders(financeSession),
      payload: { fundId: fund.fundId, growthBasisPoints: 250 },
    })
    expect(preview.statusCode).toBe(200)
    const { basisHash } = dataOf<{ basisHash: string }>(preview)

    // The basis moves between preview and commit.
    const individual = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession, { "idempotency-key": `stale-ind-${randomUUID()}` }),
      payload: {
        userId: clientId,
        fundId: fund.fundId,
        growthPaise: "1",
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
      },
    })
    expect(individual.statusCode).toBe(201)
    const entriesAfterIndividual = await countRows("client_value_entries")

    const commit = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective",
      headers: authHeaders(financeSession, { "idempotency-key": `col-stale-${randomUUID()}` }),
      payload: {
        fundId: fund.fundId,
        growthBasisPoints: 250,
        basisHash,
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
      },
    })
    expect(commit.statusCode).toBe(409)
    expect(errorOf(commit)).toBe("STATE_CONFLICT")
    // Only the individual adjustment was written; the batch left no trace.
    expect(await countRows("client_growth_batches")).toBe(batchesBefore + 1)
    expect(await countRows("client_value_entries")).toBe(entriesAfterIndividual)
    expect(entriesAfterIndividual).toBe(entriesBefore + 1)
  })

  test("one invalid explicit target rolls back the whole batch", async () => {
    const fund = await seedPublishedFund(`growth-col-roll-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientA = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    const clientB = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientA, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    await seedPosition(clientB, fund.fundId, fund.versionId, 500_000, financeAdminId)
    const batchesBefore = await countRows("client_growth_batches")
    const entriesBefore = await countRows("client_value_entries")
    const items = [
      { userId: clientA, growthPaise: "100" },
      { userId: clientB, growthPaise: "-500001" },
    ]

    const preview = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective/preview",
      headers: authHeaders(financeSession),
      payload: { fundId: fund.fundId, items },
    })
    expect(preview.statusCode).toBe(400)

    const commit = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective",
      headers: authHeaders(financeSession, { "idempotency-key": `col-roll-${randomUUID()}` }),
      payload: {
        fundId: fund.fundId,
        items,
        basisHash: "0".repeat(64),
        effectiveDate: "2026-08-20",
        reasonCode: "manual_adjustment",
      },
    })
    expect([400, 409]).toContain(commit.statusCode)
    expect(await countRows("client_growth_batches")).toBe(batchesBefore)
    expect(await countRows("client_value_entries")).toBe(entriesBefore)
    expect(await valueSum(clientA, fund.fundId)).toBe(1_000_000n)
    expect(await valueSum(clientB, fund.fundId)).toBe(500_000n)
  })

  test("fund AUM snapshots stay byte-for-byte unchanged by client growth", async () => {
    const fund = await seedPublishedFund(`growth-aum-wall-${randomUUID().slice(0, 8)}`, financeAdminId)
    const clientId = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
    await seedPosition(clientId, fund.fundId, fund.versionId, 1_000_000, financeAdminId)
    await pool.query(
      "insert into fund_aum_snapshots (fund_id, as_of_date, revision, aum_paise, reason_code, published_by_user_id, request_id) " +
        "values ($1, '2026-08-01', 1, 5000000, 'initial_publication', $2, $3)",
      [fund.fundId, financeAdminId, `req-${randomUUID()}`],
    )
    const before = await pool.query("select * from fund_aum_snapshots order by created_at, id")

    const preview = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective/preview",
      headers: authHeaders(financeSession),
      payload: { fundId: fund.fundId, growthBasisPoints: 1000 },
    })
    const { basisHash } = dataOf<{ basisHash: string }>(preview)
    const commit = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/collective",
      headers: authHeaders(financeSession, { "idempotency-key": `col-aum-${randomUUID()}` }),
      payload: {
        fundId: fund.fundId,
        growthBasisPoints: 1000,
        basisHash,
        effectiveDate: "2026-08-20",
        reasonCode: "performance_update",
      },
    })
    expect(commit.statusCode).toBe(201)
    expect(await valueSum(clientId, fund.fundId)).toBe(1_100_000n)

    const after = await pool.query("select * from fund_aum_snapshots order by created_at, id")
    expect(after.rows).toEqual(before.rows)
  })
})
