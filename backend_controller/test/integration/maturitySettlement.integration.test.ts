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
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { registerAdminClientPositionRoutes } from "../../src/routes/adminClientPositionRoutes.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerAdminMaturityRoutes } from "../../src/routes/adminMaturityRoutes.js"
import { createMaturityRepository } from "../../src/repositories/maturityRepository.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code

const cookieJar = (setCookie: string | string[] | undefined): Record<string, string> => {
  const arr = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  return Object.fromEntries(arr.map((cookie) => {
    const pair = cookie.split(";")[0] ?? ""
    const index = pair.indexOf("=")
    return [pair.slice(0, index), pair.slice(index + 1)]
  }))
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

const seedPosition = async (
  userId: string,
  fundId: string,
  versionId: string,
  amountPaise: number,
  adminId: string,
  effectiveDate = new Date().toISOString().slice(0, 10),
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
      "values ($1, $2, $3, 'contribution', $4, $4, $9, $5, $6, 'investment_accepted', 'admin', $7, $8) returning id",
    [userId, fundId, allocationId, amountPaise, orderId, paymentId, adminId, `req-${randomUUID()}`, effectiveDate],
  )
  return { orderId, paymentId, allocationId, entryId: entry.rows[0]!.id }
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
        webAuth, unitOfWork, database, clock: () => new Date(),
        config: { idempotencyTtlMs: 86_400_000 },
        clientGrowthRepository: createClientGrowthRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
        notificationRepository: createNotificationRepository(),
      })
      registerAdminClientPositionRoutes(instance, {
        webAuth, unitOfWork, database, clock: () => new Date(),
        config: { idempotencyTtlMs: 86_400_000 },
        clientPositionRepository: createClientPositionRepository(),
        userRepository: createUserRepository(),
        clientGrowthRepository: createClientGrowthRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
        notificationRepository: createNotificationRepository(),
      })
      registerAdminMaturityRoutes(instance, {
        maturityRepository: createMaturityRepository(),
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
    },
  })

  financeAdminId = await createAdmin("maturity-finance@example.com", "finance")
  await createAdmin("maturity-support@example.com", "support")
  financeSession = await login("maturity-finance@example.com")
  supportSession = await login("maturity-support@example.com")
}, 220_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

const TODAY = new Date().toISOString().slice(0, 10)
const fixture = async () => {
  const fund = await seedPublishedFund(`maturity-${randomUUID().slice(0, 8)}`, financeAdminId)
  const userId = await seedClient(`client-${randomUUID().slice(0, 8)}@example.com`)
  await seedPosition(userId, fund.fundId, fund.versionId, 100_000, financeAdminId)
  const url = `/v1/admin/clients/${userId}/maturities`
  const marked = await app.inject({
    method: "POST", url,
    headers: authHeaders(financeSession, { "idempotency-key": randomUUID() }),
    payload: { fundId: fund.fundId, maturedOn: TODAY, reasonCode: "maturity_settlement" },
  })
  expect(marked.statusCode, marked.body).toBe(201)
  return { userId, fundId: fund.fundId, maturityId: dataOf<{ maturityId: string }>(marked).maturityId, url }
}
const withdrawal = (position: Awaited<ReturnType<typeof fixture>>, key = randomUUID()) => ({
  method: "POST" as const,
  url: `${position.url}/${position.maturityId}/withdrawal`,
  headers: authHeaders(financeSession, { "idempotency-key": key }),
  payload: { fundId: position.fundId, effectiveDate: TODAY, amountPaise: "30000", reasonCode: "maturity_settlement" },
})

describe("maturity database and authorization integrity", () => {
  test("withdrawal persists its payout atomically, replays once and cannot settle twice", async () => {
    const position = await fixture()
    const request = withdrawal(position)
    const first = await app.inject(request)
    expect(first.statusCode, first.body).toBe(201)
    const settled = dataOf<{ entryId: string; payoutId: string }>(first)
    const replay = await app.inject(request)
    expect(replay.statusCode).toBe(201)
    expect(dataOf(replay)).toEqual(dataOf(first))
    const conflict = await app.inject({ ...request, payload: { ...request.payload, amountPaise: "30001" } })
    expect(conflict.statusCode).toBe(409)
    expect(errorOf(conflict)).toBe("IDEMPOTENCY_KEY_REUSED")
    const duplicate = await app.inject(withdrawal(position))
    expect(duplicate.statusCode).toBe(409)
    const records = await pool.query<{ ledger_entry_id: string; state: string; amount_paise: string; version: string }>("select * from withdrawal_operations where maturity_id = $1", [position.maturityId])
    expect(records.rows).toHaveLength(1)
    expect(records.rows[0]).toMatchObject({ ledger_entry_id: settled.entryId, state: "pending", amount_paise: "30000" })
    expect(await principalSum(position.userId, position.fundId)).toBe(70_000n)
    expect(await valueSum(position.userId, position.fundId)).toBe(70_000n)
    const paid = await app.inject({
      method: "POST", url: `/v1/admin/clients/${position.userId}/withdrawal-payouts/${settled.payoutId}/status`,
      headers: authHeaders(financeSession, { "idempotency-key": randomUUID() }),
      payload: { state: "paid", expectedVersion: Number(records.rows[0]?.version), transferReference: "BANK-TEST-123" },
    })
    expect(paid.statusCode, paid.body).toBe(200)
    const stale = await app.inject({
      method: "POST", url: `/v1/admin/clients/${position.userId}/withdrawal-payouts/${settled.payoutId}/status`,
      headers: authHeaders(financeSession, { "idempotency-key": randomUUID() }),
      payload: { state: "failed", expectedVersion: Number(records.rows[0]?.version), failureCode: "bank_rejected" },
    })
    expect(stale.statusCode).toBe(409)
    expect(await valueSum(position.userId, position.fundId)).toBe(70_000n)
  })

  test("requires financial permission, CSRF and idempotency before writing money", async () => {
    const position = await fixture()
    const request = withdrawal(position)
    const denied = await app.inject({ ...request, headers: authHeaders(supportSession, { "idempotency-key": randomUUID() }) })
    expect(denied.statusCode).toBe(403)
    expect(errorOf(denied)).toBe("AUTHORIZATION_DENIED")
    const noKey = await app.inject({ ...request, headers: authHeaders(financeSession) })
    expect(noKey.statusCode).toBe(400)
    const noCsrf = await app.inject({ ...request, headers: { origin: ORIGIN, cookie: cookieHeader(financeSession.jar), "idempotency-key": randomUUID() } })
    expect(noCsrf.statusCode).toBe(403)
    expect(await valueSum(position.userId, position.fundId)).toBe(100_000n)
    expect((await pool.query("select id from withdrawal_operations where maturity_id = $1", [position.maturityId])).rows).toHaveLength(0)
  })

  test("a payout persistence failure rolls back the ledger, maturity and idempotency claim", async () => {
    const position = await fixture()
    await pool.query(`CREATE FUNCTION reject_test_payout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected payout failure'; END $$`)
    await pool.query("CREATE TRIGGER reject_test_payout BEFORE INSERT ON withdrawal_operations FOR EACH ROW EXECUTE FUNCTION reject_test_payout()")
    const request = withdrawal(position)
    try {
      const response = await app.inject(request)
      expect(response.statusCode).toBe(500)
      expect(await valueSum(position.userId, position.fundId)).toBe(100_000n)
      const row = await pool.query("select state, settlement_entry_id from client_position_maturities where id = $1", [position.maturityId])
      expect(row.rows[0]).toEqual({ state: "pending", settlement_entry_id: null })
      expect((await pool.query("select id from withdrawal_operations where maturity_id = $1", [position.maturityId])).rows).toHaveLength(0)
    } finally {
      await pool.query("DROP TRIGGER reject_test_payout ON withdrawal_operations")
      await pool.query("DROP FUNCTION reject_test_payout()")
    }
    const retry = await app.inject(request)
    expect(retry.statusCode, retry.body).toBe(201)
    expect(await valueSum(position.userId, position.fundId)).toBe(70_000n)
  })

  test("concurrent settlements produce exactly one withdrawal and payout", async () => {
    const position = await fixture()
    const responses = await Promise.all([app.inject(withdrawal(position)), app.inject(withdrawal(position))])
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409])
    expect(errorOf(responses.find((response) => response.statusCode === 409)!)).toBe("STATE_CONFLICT")
    expect(await principalSum(position.userId, position.fundId)).toBe(70_000n)
    expect(await valueSum(position.userId, position.fundId)).toBe(70_000n)
    expect((await pool.query("select id from withdrawal_operations where maturity_id = $1", [position.maturityId])).rows).toHaveLength(1)
    expect((await pool.query("select id from client_value_entries where user_id = $1 and entry_type = 'withdrawal'", [position.userId])).rows).toHaveLength(1)
  })

  test("reinvestment capitalizes growth once and never creates a payout", async () => {
    const position = await fixture()
    const growth = await app.inject({
      method: "POST",
      url: "/v1/admin/client-growth/individual",
      headers: authHeaders(financeSession, { "idempotency-key": randomUUID() }),
      payload: { userId: position.userId, fundId: position.fundId, growthPaise: "20000", effectiveDate: TODAY, reasonCode: "valuation_update" },
    })
    expect(growth.statusCode, growth.body).toBe(201)
    const request = {
      method: "POST" as const, url: `${position.url}/${position.maturityId}/reinvestment`,
      headers: authHeaders(financeSession, { "idempotency-key": randomUUID() }),
      payload: { fundId: position.fundId, effectiveDate: TODAY, reasonCode: "maturity_settlement" },
    }
    const response = await app.inject(request)
    expect(response.statusCode, response.body).toBe(201)
    expect(dataOf(response)).toMatchObject({ payoutId: null, principalPaise: "120000", currentValuePaise: "120000", principalDeltaPaise: "20000", valueDeltaPaise: "0" })
    expect(dataOf(await app.inject(request))).toEqual(dataOf(response))
    expect(await principalSum(position.userId, position.fundId)).toBe(120_000n)
    expect(await valueSum(position.userId, position.fundId)).toBe(120_000n)
    expect((await pool.query("select id from withdrawal_operations where maturity_id = $1", [position.maturityId])).rows).toHaveLength(0)
  })

  test("payout status remains scoped to its client and failure preserves the withdrawal debit", async () => {
    const position = await fixture()
    const otherClient = await seedClient(`other-${randomUUID().slice(0, 8)}@example.com`)
    const response = await app.inject(withdrawal(position))
    expect(response.statusCode, response.body).toBe(201)
    const { payoutId } = dataOf<{ payoutId: string }>(response)
    const request = {
      method: "POST" as const, url: `/v1/admin/clients/${otherClient}/withdrawal-payouts/${payoutId}/status`,
      headers: authHeaders(financeSession, { "idempotency-key": randomUUID() }),
      payload: { state: "failed", expectedVersion: 0, failureCode: "bank_rejected" },
    }
    const denied = await app.inject(request)
    expect(denied.statusCode).toBe(409)
    expect(errorOf(denied)).toBe("STATE_CONFLICT")
    const failed = await app.inject({ ...request, url: `/v1/admin/clients/${position.userId}/withdrawal-payouts/${payoutId}/status` })
    expect(failed.statusCode, failed.body).toBe(200)
    expect(await valueSum(position.userId, position.fundId)).toBe(70_000n)
    const payout = await pool.query("select state, failure_code, transfer_reference, version from withdrawal_operations where id = $1", [payoutId])
    expect(payout.rows[0]).toMatchObject({ state: "failed", failure_code: "bank_rejected", transfer_reference: null, version: "1" })
  })

  test("rejects a reversal that would make an earlier statement negative despite a positive current balance", async () => {
    const fund = await seedPublishedFund(`history-${randomUUID().slice(0, 8)}`, financeAdminId)
    const userId = await seedClient(`history-${randomUUID().slice(0, 8)}@example.com`)
    const original = await seedPosition(userId, fund.fundId, fund.versionId, 100_000, financeAdminId, "2026-01-01")
    const marked = await app.inject({
      method: "POST", url: `/v1/admin/clients/${userId}/maturities`,
      headers: authHeaders(financeSession, { "idempotency-key": randomUUID() }),
      payload: { fundId: fund.fundId, maturedOn: "2026-02-01", reasonCode: "maturity_settlement" },
    })
    expect(marked.statusCode, marked.body).toBe(201)
    const { maturityId } = dataOf<{ maturityId: string }>(marked)
    const withdrawn = await app.inject({
      method: "POST", url: `/v1/admin/clients/${userId}/maturities/${maturityId}/withdrawal`,
      headers: authHeaders(financeSession, { "idempotency-key": randomUUID() }),
      payload: { fundId: fund.fundId, effectiveDate: "2026-02-01", amountPaise: "80000", reasonCode: "maturity_settlement" },
    })
    expect(withdrawn.statusCode, withdrawn.body).toBe(201)
    await seedPosition(userId, fund.fundId, fund.versionId, 100_000, financeAdminId, "2026-03-01")
    const reversed = await app.inject({
      method: "POST", url: `/v1/admin/clients/${userId}/ledger-entries/${original.entryId}/reversal`,
      headers: authHeaders(financeSession, { "idempotency-key": randomUUID() }),
      payload: { reasonCode: "admin_correction_reversal" },
    })
    expect(reversed.statusCode, reversed.body).toBe(409)
    expect(errorOf(reversed)).toBe("STATE_CONFLICT")
    expect(await valueSum(userId, fund.fundId)).toBe(120_000n)
    expect((await pool.query("select id from client_value_entries where reverses_entry_id = $1", [original.entryId])).rows).toHaveLength(0)
  })

  test.each([
    ["withdrawal", "0", "0"],
    ["withdrawal", "-30001", "-30000"],
    ["maturity_reinvestment", "0", "0"],
    ["maturity_reinvestment", "100", "100"],
  ])("database rejects malformed %s principal=%s value=%s", async (entryType, principal, value) => {
    const position = await fixture()
    await expect(pool.query(
      "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, reason_code, actor_type, created_by_user_id, request_id) values ($1, $2, $3, $4, $5, current_date, 'maturity_settlement', 'admin', $6, $7)",
      [position.userId, position.fundId, entryType, principal, value, financeAdminId, randomUUID()],
    )).rejects.toMatchObject({ code: "23514" })
  })
})
