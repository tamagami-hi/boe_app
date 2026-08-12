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
import { registerNativeAuthRoutes, type NativeAuthRouteDeps } from "../../src/routes/nativeAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

const PASSWORD = "correct horse battery staple"
const DEVICE = { installationId: randomUUID(), name: "Pixel", platform: "android" as const, appVersion: "1.2.3" }

interface NativeResult {
  user: { accountStatus: string; phoneMasked: string; email: string }
  accessToken: string
  refreshToken: string
  sessionId: string
}
const dataOf = <T>(response: { json: () => unknown }): T =>
  (response.json() as { data: T }).data

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
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })

  const deps: NativeAuthRouteDeps = {
    userRepository: createUserRepository(),
    authSessionRepository: createAuthSessionRepository(),
    auditRepository: createAuditRepository(),
    accessTokenService,
    database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rt1",
    clock: () => new Date(),
    unitOfWork: createUnitOfWork(database),
  }

  app = createApplication({ logger: false, registerRoutes: (instance) => registerNativeAuthRoutes(instance, deps) })

  // Seed what an approval now produces: an active user with the signup password
  // already in user_credentials. There is no activation step anymore.
  const userRow = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ('activate@example.com','+14155550123','Native User','active', now()) returning id",
  )
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [
    userRow.rows[0]?.id,
    await hashPassword(PASSWORD),
  ])
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("native authentication (integration)", () => {
  test("login succeeds and replaces the same-device session; wrong password is 401", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/v1/auth/native/login",
      payload: { email: "activate@example.com", password: PASSWORD, device: DEVICE },
    })
    expect(ok.statusCode).toBe(200)
    const session = dataOf<NativeResult>(ok)
    expect(session.sessionId).toBeDefined()
    expect(session.user.accountStatus).toBe("active")
    expect(session.user.phoneMasked).toMatch(/^\+[1-9][0-9]{0,2}[*]{6}[0-9]{4}$/u)
    expect(session.accessToken.length).toBeGreaterThan(100)
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)

    const active = await pool.query<{ c: number }>(
      "select count(*)::int as c from auth_sessions where state = 'active' and channel = 'native'",
    )
    expect(active.rows[0]?.c).toBe(1)

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/native/login",
      payload: { email: "activate@example.com", password: "wrong password value", device: DEVICE },
    })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json<{ error: { code: string } }>().error.code).toBe("INVALID_CREDENTIALS")

    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/native/login",
      payload: { email: "nobody@example.com", password: PASSWORD, device: DEVICE },
    })
    expect(unknown.statusCode).toBe(401)
  })

  test("refresh rotates the token, reproduces on same-rotationId retry, and revokes on reuse", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/native/login",
      payload: { email: "activate@example.com", password: PASSWORD, device: DEVICE },
    })
    const original = dataOf<NativeResult>(login)
    const rotationId = randomUUID()

    // First rotation consumes gen N and issues gen N+1.
    const rotated = await app.inject({
      method: "POST",
      url: "/v1/auth/native/refresh",
      payload: { refreshToken: original.refreshToken, rotationId },
    })
    expect(rotated.statusCode).toBe(200)
    const successor = dataOf<NativeResult>(rotated)
    expect(successor.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(successor.refreshToken).not.toBe(original.refreshToken)

    // Same rotationId re-presentation of the previous token reproduces the successor (no new rotation).
    const reproduced = await app.inject({
      method: "POST",
      url: "/v1/auth/native/refresh",
      payload: { refreshToken: original.refreshToken, rotationId },
    })
    expect(reproduced.statusCode).toBe(200)
    expect(dataOf<NativeResult>(reproduced).refreshToken).toBe(successor.refreshToken)

    // Reusing the previous token with a DIFFERENT rotationId revokes the family.
    const reuse = await app.inject({
      method: "POST",
      url: "/v1/auth/native/refresh",
      payload: { refreshToken: original.refreshToken, rotationId: randomUUID() },
    })
    expect(reuse.statusCode).toBe(401)
    expect(reuse.json<{ error: { code: string } }>().error.code).toBe("SESSION_INVALID")

    // The successor no longer works because the family is revoked.
    const afterRevoke = await app.inject({
      method: "POST",
      url: "/v1/auth/native/refresh",
      payload: { refreshToken: successor.refreshToken, rotationId: randomUUID() },
    })
    expect(afterRevoke.statusCode).toBe(401)
  })

  test("logout revokes the session with a valid bearer and rejects a missing one", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/native/login",
      payload: { email: "activate@example.com", password: PASSWORD, device: DEVICE },
    })
    const session = dataOf<NativeResult>(login)

    const noBearer = await app.inject({
      method: "POST",
      url: "/v1/auth/native/logout",
      payload: { refreshToken: session.refreshToken },
    })
    expect(noBearer.statusCode).toBe(401)

    const loggedOut = await app.inject({
      method: "POST",
      url: "/v1/auth/native/logout",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { refreshToken: session.refreshToken },
    })
    expect(loggedOut.statusCode).toBe(200)
    expect(dataOf<{ loggedOut: boolean }>(loggedOut).loggedOut).toBe(true)

    const revoked = await pool.query<{ state: string }>(
      "select state from auth_sessions where id = $1",
      [session.sessionId],
    )
    expect(revoked.rows[0]?.state).toBe("revoked")
  })
})
