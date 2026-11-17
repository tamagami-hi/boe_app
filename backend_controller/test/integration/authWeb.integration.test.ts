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
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerClientWebAuthRoutes } from "../../src/routes/clientWebAuthRoutes.js"
import { registerWebAuthRoutes, type WebAuthRouteDeps } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let adminUserId: string
let clientUserId: string

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"

interface WebBody {
  user: { userId: string; roles: string[]; permissions: string[] }
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

const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code

const csrfRead = (jar: Record<string, string>, url = "/v1/auth/web/csrf", on: FastifyInstance = app) =>
  on.inject({ method: "GET", url, headers: { origin: ORIGIN, cookie: cookieHeader(jar) } })

const readCsrf = async (jar: Record<string, string>): Promise<string> => {
  const response = await csrfRead(jar)
  expect(response.statusCode).toBe(200)
  const body = dataOf<WebBody>(response)
  expect(body.user.userId).toBe(adminUserId)
  expect(body.user.roles).toContain("onboarding")
  return body.csrfToken
}

const readClientCsrf = async (jar: Record<string, string>): Promise<string> => {
  const response = await csrfRead(jar, "/v1/auth/client/web/csrf")
  expect(response.statusCode).toBe(200)
  const body = dataOf<WebBody>(response)
  expect(body.user.userId).toBe(clientUserId)
  return body.csrfToken
}

const refresh = (jar: Record<string, string>, csrf: string, rotationId: string) =>
  app.inject({
    method: "POST",
    url: "/v1/auth/web/refresh",
    headers: { origin: ORIGIN, cookie: cookieHeader(jar), "x-csrf-token": csrf },
    payload: { rotationId },
  })

const logout = (jar: Record<string, string>, csrf: string) =>
  app.inject({
    method: "POST",
    url: "/v1/auth/web/logout",
    headers: { origin: ORIGIN, cookie: cookieHeader(jar), "x-csrf-token": csrf },
  })

let webDeps: WebAuthRouteDeps

/** Builds an app over the shared database under a chosen cookie policy. */
const buildTestApp = (overrides: { readonly cookieSecure: boolean; readonly clock?: () => Date }) => {
  const instanceDeps: WebAuthRouteDeps = {
    ...webDeps,
    clock: overrides.clock ?? webDeps.clock,
    config: { ...webDeps.config, cookieSecure: overrides.cookieSecure },
  }
  return createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerWebAuthRoutes(instance, instanceDeps)
      registerClientWebAuthRoutes(instance, instanceDeps)
    },
  })
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
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  const accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-web",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })
  webDeps = {
    userRepository: createUserRepository(),
    authSessionRepository: createAuthSessionRepository(),
    auditRepository: createAuditRepository(),
    loginEventRepository: createLoginEventRepository(),
    accessTokenService,
    database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rt1",
    csrfKeyVersion: "cs1",
    clock: () => new Date(),
    config: { cookieSecure: false, originAllowlist: [ORIGIN] },
    unitOfWork: createUnitOfWork(database),
  }
  app = buildTestApp({ cookieSecure: false })

  // Active admin user with credential + onboarding role + one permission grant.
  const userRow = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ('admin@example.com','+14155559001','Admin User','active', now()) returning id",
  )
  const userId = userRow.rows[0]?.id
  adminUserId = userId ?? ""
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1,$2)", [
    userId,
    await hashPassword(PASSWORD),
  ])
  const clientRow = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ('client@example.com','+14155559002','Client User','active', now()) returning id",
  )
  clientUserId = clientRow.rows[0]?.id ?? ""
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1,$2)", [
    clientUserId,
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
    // This harness runs the non-TLS policy (cookieSecure: false), so the names must
    // NOT carry the `__Host-` prefix: browsers discard a `__Host-` cookie that has
    // no `Secure` attribute, which would make login silently impossible.
    expect(cookies).toContain("boe_access=")
    expect(cookies).toContain("boe_refresh=")
    expect(cookies).not.toContain("__Host-")
    expect(cookies).not.toContain("Secure")
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

  test("the TLS policy prefixes the cookie names and marks them Secure", async () => {
    // Same login against a secure-cookie config: prefix and Secure travel together.
    const secureApp = buildTestApp({ cookieSecure: true })
    try {
      const response = await secureApp.inject({
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
      expect(cookies).toContain("Secure")

      // A session issued under the TLS policy is still readable, which is what makes
      // flipping the policy non-breaking for logged-in admins.
      const jar: Record<string, string> = {}
      for (const cookie of Array.isArray(setCookie) ? setCookie : [String(setCookie)]) {
        const [pair] = cookie.split(";")
        const index = (pair ?? "").indexOf("=")
        if (index > 0) jar[(pair ?? "").slice(0, index)] = (pair ?? "").slice(index + 1)
      }
      const csrf = await secureApp.inject({
        method: "GET",
        url: "/v1/auth/web/csrf",
        headers: { origin: ORIGIN, cookie: cookieHeader(jar) },
      })
      expect(csrf.statusCode).toBe(200)
    } finally {
      await secureApp.close()
    }
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

  test("two CSRF reads return the sign-in token, and a write with it succeeds after the second read", async () => {
    const { jar, csrf } = await login()

    const first = await readCsrf(jar)
    const second = await readCsrf(jar)
    expect(first).toBe(csrf)
    expect(second).toBe(csrf)

    expect((await logout(jar, second)).statusCode).toBe(200)
  })

  test("after a refresh rotation the old CSRF token is refused and the new one works", async () => {
    const { jar, csrf } = await login()
    const rotated = await refresh(jar, csrf, randomUUID())
    expect(rotated.statusCode).toBe(200)
    const rotatedJar = cookieJar(rotated.headers["set-cookie"])
    const rotatedCsrf = dataOf<WebBody>(rotated).csrfToken
    expect(rotatedCsrf).not.toBe(csrf)
    expect(await readCsrf(rotatedJar)).toBe(rotatedCsrf)

    const stale = await logout(rotatedJar, csrf)
    expect(stale.statusCode).toBe(403)
    expect(errorOf(stale)).toBe("CSRF_INVALID")
    expect((await logout(rotatedJar, rotatedCsrf)).statusCode).toBe(200)
  })

  test("a refresh whose reply was lost, retried within the grace after a CSRF read, keeps the session", async () => {
    const { jar, csrf: signInCsrf } = await login()
    const first = await refresh(jar, signInCsrf, randomUUID())
    expect(first.statusCode).toBe(200)
    const tabJar = cookieJar(first.headers["set-cookie"])
    const tabCsrf = dataOf<WebBody>(first).csrfToken

    const rotationId = randomUUID()
    const lost = await refresh(tabJar, tabCsrf, rotationId)
    expect(lost.statusCode).toBe(200)
    const lostJar = cookieJar(lost.headers["set-cookie"])
    const lostCsrf = dataOf<WebBody>(lost).csrfToken

    const refreshOnly = { boe_refresh: tabJar["boe_refresh"] ?? "" }
    const recovered = await readCsrf(refreshOnly)
    expect(recovered).toBe(lostCsrf)

    const retried = await refresh(refreshOnly, recovered, rotationId)
    expect(retried.statusCode).toBe(200)
    expect(dataOf<WebBody>(retried).csrfToken).toBe(lostCsrf)
    expect(cookieJar(retried.headers["set-cookie"])["boe_refresh"]).toBe(lostJar["boe_refresh"])

    const retriedWithTabToken = await refresh(refreshOnly, tabCsrf, rotationId)
    expect(retriedWithTabToken.statusCode).toBe(200)
    expect(await readCsrf(lostJar)).toBe(lostCsrf)

    const retriedWithOlderToken = await refresh(refreshOnly, signInCsrf, rotationId)
    expect(retriedWithOlderToken.statusCode).toBe(401)
    const revoked = await app.inject({
      method: "GET",
      url: "/v1/auth/web/csrf",
      headers: { origin: ORIGIN, cookie: cookieHeader(lostJar) },
    })
    expect(revoked.statusCode).toBe(401)
  })

  test("the client web CSRF read names the client and keeps its sign-in token", async () => {
    const signedIn = await app.inject({
      method: "POST",
      url: "/v1/auth/client/web/login",
      headers: { origin: ORIGIN },
      payload: { email: "client@example.com", password: PASSWORD },
    })
    expect(signedIn.statusCode).toBe(200)
    const jar = cookieJar(signedIn.headers["set-cookie"])
    const csrf = dataOf<WebBody>(signedIn).csrfToken

    expect(await readClientCsrf(jar)).toBe(csrf)
    expect(await readClientCsrf(jar)).toBe(csrf)
    const loggedOut = await app.inject({
      method: "POST",
      url: "/v1/auth/client/web/logout",
      headers: { origin: ORIGIN, cookie: cookieHeader(jar), "x-csrf-token": csrf },
    })
    expect(loggedOut.statusCode).toBe(200)
  })

  test("an upper-case rotationId keeps the rotated token on read and replays within the grace", async () => {
    const { jar, csrf } = await login()
    const rotationId = randomUUID().toUpperCase()
    const rotated = await refresh(jar, csrf, rotationId)
    expect(rotated.statusCode).toBe(200)
    const rotatedJar = cookieJar(rotated.headers["set-cookie"])
    const rotatedCsrf = dataOf<WebBody>(rotated).csrfToken
    expect(await readCsrf(rotatedJar)).toBe(rotatedCsrf)

    const retried = await refresh({ boe_refresh: jar["boe_refresh"] ?? "" }, rotatedCsrf, rotationId)
    expect(retried.statusCode).toBe(200)
    expect(dataOf<WebBody>(retried).csrfToken).toBe(rotatedCsrf)
    expect((await logout(rotatedJar, rotatedCsrf)).statusCode).toBe(200)
  })

  test("a CSRF read with a used refresh cookie outside the grace is refused and keeps the session", async () => {
    const { jar, csrf } = await login()
    const first = await refresh(jar, csrf, randomUUID())
    const firstJar = cookieJar(first.headers["set-cookie"])
    const second = await refresh(firstJar, dataOf<WebBody>(first).csrfToken, randomUUID())
    expect(second.statusCode).toBe(200)
    const currentJar = cookieJar(second.headers["set-cookie"])
    const currentCsrf = dataOf<WebBody>(second).csrfToken

    const older = await csrfRead({ boe_refresh: jar["boe_refresh"] ?? "" })
    expect(older.statusCode).toBe(401)
    expect(errorOf(older)).toBe("SESSION_INVALID")

    const previous = { boe_refresh: firstJar["boe_refresh"] ?? "" }
    expect(await readCsrf(previous)).toBe(currentCsrf)
    const later = buildTestApp({ cookieSecure: false, clock: () => new Date(Date.now() + 31_000) })
    try {
      const afterGrace = await csrfRead(previous, "/v1/auth/web/csrf", later)
      expect(afterGrace.statusCode).toBe(401)
      expect(errorOf(afterGrace)).toBe("SESSION_INVALID")
    } finally {
      await later.close()
    }

    expect(await readCsrf({ boe_refresh: currentJar["boe_refresh"] ?? "" })).toBe(currentCsrf)
    expect((await logout(currentJar, currentCsrf)).statusCode).toBe(200)
  })

  test("a CSRF token of another session is refused", async () => {
    const own = await login()
    const other = await login()
    expect(other.csrf).not.toBe(own.csrf)
    expect(await readCsrf(own.jar)).toBe(own.csrf)
    expect(await readCsrf(other.jar)).toBe(other.csrf)

    const crossed = await logout(own.jar, other.csrf)
    expect(crossed.statusCode).toBe(403)
    expect(errorOf(crossed)).toBe("CSRF_INVALID")
    expect((await logout(own.jar, own.csrf)).statusCode).toBe(200)
  })

  test("GET /v1/auth/web/csrf recovers from the refresh cookie when the access cookie is absent", async () => {
    const { jar } = await login()
    const refreshOnly: Record<string, string> = {}
    const refreshValue = jar["boe_refresh"]
    if (refreshValue !== undefined) refreshOnly["boe_refresh"] = refreshValue

    const recovered = await app.inject({
      method: "GET",
      url: "/v1/auth/web/csrf",
      headers: { origin: ORIGIN, cookie: cookieHeader(refreshOnly) },
    })
    expect(recovered.statusCode).toBe(200)
    expect(dataOf<WebBody>(recovered).csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  })

  test("GET /v1/auth/web/csrf rejects a cross-site origin", async () => {
    const { jar } = await login()
    const bad = await app.inject({
      method: "GET",
      url: "/v1/auth/web/csrf",
      headers: { origin: "https://evil.example", cookie: cookieHeader(jar) },
    })
    expect(bad.statusCode).toBe(403)
  })

  test("GET /v1/auth/web/csrf requires an authenticated session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/web/csrf",
      headers: { origin: ORIGIN },
    })
    expect(res.statusCode).toBe(401)
  })

  test("admin sign-in attempts are recorded on the web channel", async () => {
    await pool.query("delete from auth_login_events")
    await login()

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/web/login",
      headers: { origin: ORIGIN },
      payload: { email: "admin@example.com", password: "definitely not the password" },
    })
    expect(wrong.statusCode).toBe(401)

    const events = await pool.query<{ outcome: string; channel: string; session_id: string | null }>(
      "select outcome, channel, session_id from auth_login_events order by occurred_at asc, id asc",
    )
    expect(events.rows.map((row) => row.outcome)).toEqual(["success", "invalid_credentials"])
    // Recorded against the web channel, so admin and client history are
    // distinguishable in the same table.
    expect(events.rows.every((row) => row.channel === "web")).toBe(true)
    expect(events.rows[0]?.session_id).not.toBeNull()
    expect(events.rows[1]?.session_id).toBeNull()
  })
})
