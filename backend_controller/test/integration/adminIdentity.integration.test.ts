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
import type { UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createActivationInviteRepository } from "../../src/repositories/activationInviteRepository.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createApplicationReviewRepository } from "../../src/repositories/applicationReviewRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { registerAdminIdentityRoutes, type AdminIdentityDeps } from "../../src/routes/adminIdentityRoutes.js"
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

const key = (bytes: number): string => randomBytes(bytes).toString("base64")
const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const metaOf = (response: { json: () => unknown }): { page?: { nextCursor: string | null; hasMore: boolean } } =>
  (response.json() as { meta: { page?: { nextCursor: string | null; hasMore: boolean } } }).meta

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

const createAdmin = async (email: string, roleCode: "onboarding" | "support"): Promise<string> => {
  const userRow = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Admin User', 'active', now()) returning id",
    [email, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
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

const seedSubmittedApplication = async (email: string): Promise<{ id: string; version: number }> => {
  const row = await pool.query<{ id: string; version: string }>(
    "insert into applications (email_normalized, phone_e164, full_name, state, email_verified_at, submitted_at) " +
      "values ($1, $2, 'Ada Lovelace', 'submitted', now(), now()) returning id, version",
    [email, `+1415555${String(Math.floor(1000000 + Math.random() * 8999999))}`],
  )
  const created = row.rows[0]
  if (created === undefined) throw new Error("failed to seed application")
  return { id: created.id, version: Number(created.version) }
}

const authHeaders = (session: Session, extra: Record<string, string> = {}): Record<string, string> => ({
  origin: ORIGIN,
  cookie: cookieHeader(session.jar),
  "x-csrf-token": session.csrf,
  ...extra,
})

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
  const crypto = createCryptoContext(
    parseCryptoKeys({
      CRYPTO_TOKEN_HASH_KEY: key(32),
      CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
      CRYPTO_CONSENT_IP_HMAC_KEY: key(32),
      CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
      CRYPTO_RECIPIENT_HMAC_KEY: key(32),
      CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
      CRYPTO_RECIPIENT_ENC_KEY: key(32),
      CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
    }),
  )
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
  const adminDeps: AdminIdentityDeps = {
    webAuth,
    unitOfWork,
    database,
    clock: () => new Date(),
    crypto,
    config: {
      cursorKey: randomBytes(32),
      idempotencyTtlMs: 86_400_000,
      activationInviteTtlMs: 7 * 86_400_000,
      sesConfigurationSet: "boe-transactional",
    },
    applicationRepository: createApplicationRepository(),
    applicationReviewRepository: createApplicationReviewRepository(),
    userRepository: createUserRepository(),
    credentialRepository: createCredentialRepository(),
    activationInviteRepository: createActivationInviteRepository(),
    outboxRepository: createOutboxRepository(),
    emailDeliveryRepository: createEmailDeliveryRepository(),
    auditRepository: createAuditRepository(),
    idempotencyRepository: createIdempotencyRepository(),
  }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerWebAuthRoutes(instance, { ...webAuth, unitOfWork })
      registerAdminIdentityRoutes(instance, adminDeps)
    },
  })

  await createAdmin("admin@example.com", "onboarding")
  await createAdmin("support@example.com", "support")
}, 220_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("admin identity RBAC (integration)", () => {
  test("denies a support principal the applications.read permission with 403", async () => {
    const session = await login("support@example.com")
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/applications",
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(response.statusCode).toBe(403)
  })

  test("rejects an unauthenticated request with 401", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/admin/applications", headers: { origin: ORIGIN } })
    expect(response.statusCode).toBe(401)
  })
})

describe("admin application review + decision (integration)", () => {
  test("approves an application: user + invite + activation outbox + delivery", async () => {
    const session = await login("admin@example.com")
    const application = await seedSubmittedApplication("approve-me@example.com")

    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/review`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { expectedVersion: application.version },
    })
    expect(reviewed.statusCode).toBe(200)
    const reviewedBody = dataOf<{ status: string; version: number }>(reviewed)
    expect(reviewedBody.status).toBe("in_review")

    const decided = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/decision?outcome=approved`,
      headers: authHeaders(session, { "idempotency-key": randomUUID(), "if-match": `"${String(reviewedBody.version)}"` }),
      payload: { reasonCode: "eligibility_confirmed" },
    })
    expect(decided.statusCode).toBe(200)
    const decidedBody = dataOf<{ status: string; userId?: string; activationInviteId?: string; emailDeliveryId: string }>(
      decided,
    )
    expect(decidedBody.status).toBe("approved")
    expect(decidedBody.userId).toBeDefined()
    expect(decidedBody.activationInviteId).toBeDefined()

    const user = await pool.query("select account_state from users where id = $1", [decidedBody.userId])
    expect(user.rows[0]).toMatchObject({ account_state: "invited" })
    const invite = await pool.query("select state from activation_invites where id = $1", [
      decidedBody.activationInviteId,
    ])
    expect(invite.rows[0]).toMatchObject({ state: "pending" })
    const outbox = await pool.query(
      "select topic, event_type from outbox_events where aggregate_id = $1 and topic = 'email'",
      [decidedBody.userId],
    )
    expect(outbox.rows[0]).toMatchObject({ event_type: "user.activation_invited" })
    const delivery = await pool.query("select template_key from email_deliveries where id = $1", [
      decidedBody.emailDeliveryId,
    ])
    expect(delivery.rows[0]).toMatchObject({ template_key: "activation_invite" })
  })

  test("rejects an application: review + rejection delivery, no user", async () => {
    const session = await login("admin@example.com")
    const application = await seedSubmittedApplication("reject-me@example.com")

    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/review`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { expectedVersion: application.version },
    })
    const version = dataOf<{ version: number }>(reviewed).version

    const decided = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/decision?outcome=rejected`,
      headers: authHeaders(session, { "idempotency-key": randomUUID(), "if-match": `"${String(version)}"` }),
      payload: { reasonCode: "ineligible" },
    })
    expect(decided.statusCode).toBe(200)
    const body = dataOf<{ status: string; userId?: string; emailDeliveryId: string }>(decided)
    expect(body.status).toBe("rejected")
    expect(body.userId).toBeUndefined()
    const delivery = await pool.query("select template_key from email_deliveries where id = $1", [body.emailDeliveryId])
    expect(delivery.rows[0]).toMatchObject({ template_key: "application_rejected" })
  })

  test("a stale version review is a 409 STATE_CONFLICT", async () => {
    const session = await login("admin@example.com")
    const application = await seedSubmittedApplication("stale@example.com")
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/review`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { expectedVersion: application.version + 5 },
    })
    expect(response.statusCode).toBe(409)
  })

  test("a decision without CSRF is rejected", async () => {
    const session = await login("admin@example.com")
    const application = await seedSubmittedApplication("nocsrf@example.com")
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/decision?outcome=approved`,
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar), "idempotency-key": randomUUID(), "if-match": '"1"' },
      payload: { reasonCode: "x" },
    })
    expect(response.statusCode).toBe(403)
  })
})

describe("admin activation invite resend (integration)", () => {
  test("revokes the pending invite and issues a replacement", async () => {
    const session = await login("admin@example.com")
    const application = await seedSubmittedApplication("resend@example.com")
    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/review`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { expectedVersion: application.version },
    })
    const decided = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/decision?outcome=approved`,
      headers: authHeaders(session, {
        "idempotency-key": randomUUID(),
        "if-match": `"${String(dataOf<{ version: number }>(reviewed).version)}"`,
      }),
      payload: { reasonCode: "ok" },
    })
    const approved = dataOf<{ userId: string; activationInviteId: string }>(decided)

    const resent = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${approved.userId}/activation-invites/resend`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { reasonCode: "user_request", expectedInviteId: approved.activationInviteId },
    })
    expect(resent.statusCode).toBe(202)
    const body = dataOf<{ revokedInviteId: string; activationInviteId: string; status: string }>(resent)
    expect(body.revokedInviteId).toBe(approved.activationInviteId)
    expect(body.activationInviteId).not.toBe(approved.activationInviteId)
    expect(body.status).toBe("queued")

    const revoked = await pool.query("select state from activation_invites where id = $1", [approved.activationInviteId])
    expect(revoked.rows[0]).toMatchObject({ state: "revoked" })
    const replacement = await pool.query("select state from activation_invites where id = $1", [
      body.activationInviteId,
    ])
    expect(replacement.rows[0]).toMatchObject({ state: "pending" })
  })
})

describe("admin reads: queue pagination, detail, deliveries (integration)", () => {
  test("paginates the application queue with an authenticated cursor", async () => {
    const session = await login("admin@example.com")
    await seedSubmittedApplication("page1@example.com")
    await seedSubmittedApplication("page2@example.com")
    await seedSubmittedApplication("page3@example.com")

    const first = await app.inject({
      method: "GET",
      url: "/v1/admin/applications?status=submitted&limit=2",
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(first.statusCode).toBe(200)
    expect(dataOf<{ items: unknown[] }>(first).items).toHaveLength(2)
    const page = metaOf(first).page
    expect(page?.hasMore).toBe(true)
    expect(page?.nextCursor).toBeTruthy()

    const second = await app.inject({
      method: "GET",
      url: `/v1/admin/applications?status=submitted&limit=2&after=${encodeURIComponent(page?.nextCursor ?? "")}`,
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(second.statusCode).toBe(200)
    expect(dataOf<{ items: unknown[] }>(second).items.length).toBeGreaterThanOrEqual(1)

    const tampered = await app.inject({
      method: "GET",
      url: "/v1/admin/applications?status=submitted&limit=2&after=not-a-valid-cursor",
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(tampered.statusCode).toBe(400)
  })

  test("returns application detail with embedded strict-safe deliveries", async () => {
    const session = await login("admin@example.com")
    const application = await seedSubmittedApplication("detail@example.com")
    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/applications/${application.id}`,
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ application: { applicationId: string }; deliveries: { items: unknown[] } }>(response)
    expect(body.application.applicationId).toBe(application.id)
    expect(Array.isArray(body.deliveries.items)).toBe(true)
  })

  test("lists email deliveries with the full projection for email_deliveries.read", async () => {
    const session = await login("admin@example.com")
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/email-deliveries?limit=5&templateKey=activation_invite&state=queued",
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(response.statusCode).toBe(200)
    const items = dataOf<{ items: { templateKey: string; sesConfigurationSet?: string }[] }>(response).items
    expect(items.length).toBeGreaterThan(0)
    // Full projection includes the configuration set (masked support projection would not).
    expect(items[0]?.sesConfigurationSet).toBeDefined()
  })

  test("returns the masked projection for a support (read_masked) principal", async () => {
    const session = await login("support@example.com")
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/email-deliveries?limit=5",
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(response.statusCode).toBe(200)
    const items = dataOf<{ items: { templateKey: string; sesConfigurationSet?: string }[] }>(response).items
    // Masked support projection excludes the configuration set and other ids.
    if (items[0] !== undefined) expect(items[0].sesConfigurationSet).toBeUndefined()
  })
})

describe("admin identity negative paths (integration)", () => {
  const approveFresh = async (session: Session, email: string) => {
    const application = await seedSubmittedApplication(email)
    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/review`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { expectedVersion: application.version },
    })
    const decided = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/decision?outcome=approved`,
      headers: authHeaders(session, {
        "idempotency-key": randomUUID(),
        "if-match": `"${String(dataOf<{ version: number }>(reviewed).version)}"`,
      }),
      payload: { reasonCode: "ok" },
    })
    return dataOf<{ userId: string; activationInviteId: string }>(decided)
  }

  test("a decision on a missing application is 404", async () => {
    const session = await login("admin@example.com")
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${randomUUID()}/decision?outcome=approved`,
      headers: authHeaders(session, { "idempotency-key": randomUUID(), "if-match": '"1"' }),
      payload: { reasonCode: "x" },
    })
    expect(response.statusCode).toBe(404)
  })

  test("a decision with a stale If-Match version is 409", async () => {
    const session = await login("admin@example.com")
    const application = await seedSubmittedApplication("stale-decision@example.com")
    await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/review`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { expectedVersion: application.version },
    })
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/decision?outcome=approved`,
      headers: authHeaders(session, { "idempotency-key": randomUUID(), "if-match": '"99"' }),
      payload: { reasonCode: "x" },
    })
    expect(response.statusCode).toBe(409)
  })

  test("a decision on an unverified in_review application is 409", async () => {
    const session = await login("admin@example.com")
    const row = await pool.query<{ id: string; version: string }>(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, review_started_at) " +
        "values ('unverified@example.com', '+14155550020', 'No Verify', 'in_review', now(), now()) returning id, version",
    )
    const created = row.rows[0]
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${created?.id ?? ""}/decision?outcome=approved`,
      headers: authHeaders(session, {
        "idempotency-key": randomUUID(),
        "if-match": `"${String(created?.version ?? "1")}"`,
      }),
      payload: { reasonCode: "x" },
    })
    expect(response.statusCode).toBe(409)
  })

  test("re-reviewing an in_review application is 409", async () => {
    const session = await login("admin@example.com")
    const application = await seedSubmittedApplication("rereview@example.com")
    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/review`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { expectedVersion: application.version },
    })
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/review`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { expectedVersion: dataOf<{ version: number }>(reviewed).version },
    })
    expect(response.statusCode).toBe(409)
  })

  test("replaying a decision with the same idempotency key returns the first result", async () => {
    const session = await login("admin@example.com")
    const application = await seedSubmittedApplication("idem-decision@example.com")
    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/review`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { expectedVersion: application.version },
    })
    const ifMatch = `"${String(dataOf<{ version: number }>(reviewed).version)}"`
    const idempotencyKey = randomUUID()
    const first = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/decision?outcome=approved`,
      headers: authHeaders(session, { "idempotency-key": idempotencyKey, "if-match": ifMatch }),
      payload: { reasonCode: "ok" },
    })
    const replay = await app.inject({
      method: "POST",
      url: `/v1/admin/applications/${application.id}/decision?outcome=approved`,
      headers: authHeaders(session, { "idempotency-key": idempotencyKey, "if-match": ifMatch }),
      payload: { reasonCode: "ok" },
    })
    expect(first.statusCode).toBe(200)
    expect(replay.statusCode).toBe(200)
    expect(dataOf<{ userId: string }>(replay).userId).toBe(dataOf<{ userId: string }>(first).userId)
  })

  test("a resend on a missing user is 404", async () => {
    const session = await login("admin@example.com")
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${randomUUID()}/activation-invites/resend`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { reasonCode: "x", expectedInviteId: randomUUID() },
    })
    expect(response.statusCode).toBe(404)
  })

  test("a resend with a wrong expected invite id is 409", async () => {
    const session = await login("admin@example.com")
    const approved = await approveFresh(session, "resend-conflict@example.com")
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${approved.userId}/activation-invites/resend`,
      headers: authHeaders(session, { "idempotency-key": randomUUID() }),
      payload: { reasonCode: "x", expectedInviteId: randomUUID() },
    })
    expect(response.statusCode).toBe(409)
  })

  test("queue accepts a valid createdFrom/createdTo range and rejects an invalid one", async () => {
    const session = await login("admin@example.com")
    const ok = await app.inject({
      method: "GET",
      url:
        "/v1/admin/applications?status=submitted&limit=5" +
        "&createdFrom=2026-01-01T00:00:00.000Z&createdTo=2026-12-31T00:00:00.000Z",
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(ok.statusCode).toBe(200)

    const bad = await app.inject({
      method: "GET",
      url:
        "/v1/admin/applications?limit=5" +
        "&createdFrom=2026-12-31T00:00:00.000Z&createdTo=2026-01-01T00:00:00.000Z",
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(bad.statusCode).toBe(400)
  })

  test("email deliveries filter by applicationId and userId and follow a cursor", async () => {
    const session = await login("admin@example.com")
    const approved = await approveFresh(session, "delivery-filter@example.com")

    const byUser = await app.inject({
      method: "GET",
      url: `/v1/admin/email-deliveries?userId=${approved.userId}&limit=1`,
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(byUser.statusCode).toBe(200)
    expect(dataOf<{ items: unknown[] }>(byUser).items.length).toBeGreaterThan(0)

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/admin/email-deliveries?limit=1",
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    const nextCursor = metaOf(firstPage).page?.nextCursor
    if (typeof nextCursor === "string") {
      const secondPage = await app.inject({
        method: "GET",
        url: `/v1/admin/email-deliveries?limit=1&after=${encodeURIComponent(nextCursor)}`,
        headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
      })
      expect(secondPage.statusCode).toBe(200)
    }

    const byApplication = await app.inject({
      method: "GET",
      url: `/v1/admin/email-deliveries?applicationId=${randomUUID()}&limit=5`,
      headers: { origin: ORIGIN, cookie: cookieHeader(session.jar) },
    })
    expect(byApplication.statusCode).toBe(200)
  })
})
