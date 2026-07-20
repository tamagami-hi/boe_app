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
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerWebAuthRoutes, type WebAuthRouteDeps } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"

interface WebBody {
  user: { roles: string[]; permissions: string[] }
  csrfToken: string
}
const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data

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

const login = async (): Promise<{ jar: Record<string, string>; csrf: string }> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/web/login",
    headers: { origin: ORIGIN },
    payload: { email: "admin@example.com", password: PASSWORD },
  })
  expect(response.statusCode).toBe(200)
  return { jar: cookieJar(response.headers["set-cookie"]), csrf: dataOf<WebBody>(response).csrfToken }
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
  const all = await loadMigrationFiles(directory)
  await runMigrations(
    pool,
    all.filter((file) => file.version >= "009"),
  )
  await runSeed(pool)

  const database = createDatabase(pool)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  const accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-web",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })
  const deps: WebAuthRouteDeps = {
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
    unitOfWork: createUnitOfWork(database),
  }
  app = createApplication({ logger: false, registerRoutes: (instance) => registerWebAuthRoutes(instance, deps) })

  // Active admin user with credential + onboarding role + one permission grant.
  const userRow = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ('admin@example.com','+14155559001','Admin User','active', now()) returning id",
  )
  const userId = userRow.rows[0]?.id
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1,$2)", [
    userId,
    await hashPassword(PASSWORD),
  ])
  const role = await pool.query<{ id: string }>("select id from roles where code = 'onboarding'")
  const permission = await pool.query<{ id: string }>("select id from permissions where code = 'applications.read'")
  await pool.query(
    "insert into role_permissions (role_id, permission_id, granted_by_user_id) values ($1,$2,$3)",
    [role.rows[0]?.id, permission.rows[0]?.id, userId],
  )
  await pool.query("insert into user_roles (user_id, role_id, granted_by_user_id) values ($1,$2,$3)", [
    userId,
    role.rows[0]?.id,
    userId,
  ])
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("web authentication (integration)", () => {
  test("login sets HttpOnly cookies and returns roles/permissions + CSRF", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/web/login",
      headers: { origin: ORIGIN },
      payload: { email: "admin@example.com", password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    const setCookie = response.headers["set-cookie"]
    const cookies = Array.isArray(setCookie) ? setCookie.join("\n") : String(setCookie)
    expect(cookies).toContain("__Host-boe_access=")
    expect(cookies).toContain("__Host-boe_refresh=")
    expect(cookies).toContain("HttpOnly")
    expect(cookies).toContain("SameSite=Lax")
    const body = dataOf<WebBody>(response)
    expect(body.user.roles).toContain("onboarding")
    expect(body.user.permissions).toContain("applications.read")
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/web/login",
      headers: { origin: ORIGIN },
      payload: { email: "admin@example.com", password: "wrong password value" },
    })
    expect(wrong.statusCode).toBe(401)
  })

  test("refresh rotates the pair and reuse with a different rotationId revokes", async () => {
    const { jar, csrf } = await login()
    const rotationId = randomUUID()
    const rotated = await app.inject({
      method: "POST",
      url: "/v1/auth/web/refresh",
      headers: { origin: ORIGIN, cookie: cookieHeader(jar), "x-csrf-token": csrf },
      payload: { rotationId },
    })
    expect(rotated.statusCode).toBe(200)
    expect(dataOf<WebBody>(rotated).csrfToken).not.toBe(csrf)

    const reuse = await app.inject({
      method: "POST",
      url: "/v1/auth/web/refresh",
      headers: { origin: ORIGIN, cookie: cookieHeader(jar), "x-csrf-token": csrf },
      payload: { rotationId: randomUUID() },
    })
    expect(reuse.statusCode).toBe(401)
  })

  test("logout requires CSRF + allowed Origin and revokes the session", async () => {
    const { jar, csrf } = await login()

    const badOrigin = await app.inject({
      method: "POST",
      url: "/v1/auth/web/logout",
      headers: { origin: "https://evil.example", cookie: cookieHeader(jar), "x-csrf-token": csrf },
    })
    expect(badOrigin.statusCode).toBe(403)

    const noCsrf = await app.inject({
      method: "POST",
      url: "/v1/auth/web/logout",
      headers: { origin: ORIGIN, cookie: cookieHeader(jar) },
    })
    expect(noCsrf.statusCode).toBe(403)

    const ok = await app.inject({
      method: "POST",
      url: "/v1/auth/web/logout",
      headers: { origin: ORIGIN, cookie: cookieHeader(jar), "x-csrf-token": csrf },
    })
    expect(ok.statusCode).toBe(200)
    expect(dataOf<{ loggedOut: boolean }>(ok).loggedOut).toBe(true)
  })
})
