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
import { createBreachChecker } from "../../src/auth/breachCheck.js"
import { hashPassword } from "../../src/auth/passwordHasher.js"
import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { createActivationInviteRepository } from "../../src/repositories/activationInviteRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerNativeAuthRoutes, type NativeAuthRouteDeps } from "../../src/routes/nativeAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

/**
 * Concurrent-device cap: three simultaneous devices for a normal client, and no
 * cap for the seeded dev/QA account.
 *
 * Driven through the real login route against real Postgres, because the whole
 * behaviour is about which `auth_sessions` rows survive — a stubbed repository
 * would assert the code we wrote rather than the state it produces.
 */

const PASSWORD = "correct horse battery staple"
const SEED_CLIENT_EMAIL = "seed-client@example.com"
const NORMAL_CLIENT_EMAIL = "capped-client@example.com"
const MAX_DEVICES = 3

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance

const b64 = (n: number): string => randomBytes(n).toString("base64")

const device = (installationId: string) => ({
  installationId,
  name: "Pixel",
  platform: "android" as const,
  appVersion: "1.2.3",
})

const login = async (email: string, installationId: string) =>
  app.inject({
    method: "POST",
    url: "/v1/auth/native/login",
    payload: { email, password: PASSWORD, device: device(installationId) },
  })

/** Active native sessions for an email, oldest first. */
const activeSessions = async (email: string): Promise<readonly string[]> => {
  const result = await pool.query<{ id: string }>(
    `select s.id from auth_sessions s
       join users u on u.id = s.user_id
      where u.email_normalized = $1 and s.channel = 'native' and s.state = 'active'
      order by s.created_at asc, s.id asc`,
    [email],
  )
  return result.rows.map((row) => row.id)
}

const revocationReasons = async (email: string): Promise<readonly (string | null)[]> => {
  const result = await pool.query<{ revocation_reason: string | null }>(
    `select s.revocation_reason from auth_sessions s
       join users u on u.id = s.user_id
      where u.email_normalized = $1 and s.state = 'revoked'
      order by s.revoked_at asc`,
    [email],
  )
  return result.rows.map((row) => row.revocation_reason)
}

const createClient = async (email: string): Promise<void> => {
  const userRow = await pool.query<{ id: string }>(
    `insert into users (email_normalized, phone_e164, full_name, account_state, activated_at)
     values ($1, $2, 'Test Client', 'active', now()) returning id`,
    [email, `+1415555${Math.floor(Math.random() * 9000 + 1000)}`],
  )
  const userId = userRow.rows[0]?.id
  await pool.query(
    `insert into user_credentials (user_id, password_hash) values ($1, $2)`,
    [userId, await hashPassword(PASSWORD)],
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
  await runMigrations(pool, await loadMigrationFiles(directory))
  await runSeed(pool)

  const database = createDatabase(pool)
  const crypto = createCryptoContext(
    parseCryptoKeys({
      CRYPTO_TOKEN_HASH_KEY: b64(32),
      CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
      CRYPTO_CONSENT_IP_HMAC_KEY: b64(32),
      CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
      CRYPTO_RECIPIENT_HMAC_KEY: b64(32),
      CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
      CRYPTO_RECIPIENT_ENC_KEY: b64(32),
      CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
    }),
  )
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
    activationInviteRepository: createActivationInviteRepository(),
    credentialRepository: createCredentialRepository(),
    authSessionRepository: createAuthSessionRepository(),
    auditRepository: createAuditRepository(),
    crypto,
    breachChecker: createBreachChecker("bypass"),
    accessTokenService,
    database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rt1",
    clock: () => new Date(),
    deviceLimit: { maxDevices: MAX_DEVICES, exemptEmails: [SEED_CLIENT_EMAIL] },
    unitOfWork: createUnitOfWork(database),
  }

  app = createApplication({ logger: false, registerRoutes: (instance) => registerNativeAuthRoutes(instance, deps) })

  await createClient(NORMAL_CLIENT_EMAIL)
  await createClient(SEED_CLIENT_EMAIL)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("native login device cap", () => {
  test("a capped client keeps only the newest three devices", async () => {
    const devices = [randomUUID(), randomUUID(), randomUUID()]
    for (const installationId of devices) {
      const response = await login(NORMAL_CLIENT_EMAIL, installationId)
      expect(response.statusCode).toBe(200)
    }

    const atCap = await activeSessions(NORMAL_CLIENT_EMAIL)
    expect(atCap).toHaveLength(MAX_DEVICES)

    // The fourth device is admitted; the oldest is evicted rather than the login
    // being refused, so a user with a lost or wiped phone can always get back in.
    const fourth = await login(NORMAL_CLIENT_EMAIL, randomUUID())
    expect(fourth.statusCode).toBe(200)

    const afterFourth = await activeSessions(NORMAL_CLIENT_EMAIL)
    expect(afterFourth).toHaveLength(MAX_DEVICES)
    expect(afterFourth).not.toContain(atCap[0])
    // The two devices that were not the oldest survive untouched.
    expect(afterFourth).toContain(atCap[1])
    expect(afterFourth).toContain(atCap[2])
    expect(await revocationReasons(NORMAL_CLIENT_EMAIL)).toContain("device_limit_exceeded")
  })

  test("re-signing in on a known device never evicts another device", async () => {
    const known = await activeSessions(NORMAL_CLIENT_EMAIL)
    expect(known).toHaveLength(MAX_DEVICES)

    // Reuse an installationId that already holds a session: the same-device
    // replacement runs first, so the cap sees only the other two devices.
    const deviceRow = await pool.query<{ device_id_hash: Buffer }>(
      "select device_id_hash from auth_sessions where id = $1",
      [known[1]],
    )
    expect(deviceRow.rows[0]?.device_id_hash).toBeDefined()

    // Sign in again from the *newest* device by replaying its installation id.
    // We cannot recover the raw id from its hash, so assert the invariant that
    // matters instead: a fresh login from a brand-new device leaves exactly the
    // cap in place, and one from an existing device would too.
    const before = await activeSessions(NORMAL_CLIENT_EMAIL)
    const reused = randomUUID()
    await login(NORMAL_CLIENT_EMAIL, reused)
    await login(NORMAL_CLIENT_EMAIL, reused)
    const after = await activeSessions(NORMAL_CLIENT_EMAIL)

    expect(after).toHaveLength(MAX_DEVICES)
    // Only one eviction happened across the two logins, not two: the second
    // login replaced its own session instead of evicting a third party.
    expect(after.filter((id) => before.includes(id))).toHaveLength(MAX_DEVICES - 1)
  })

  test("the seeded client is exempt and keeps every device", async () => {
    const total = 6
    for (let index = 0; index < total; index += 1) {
      const response = await login(SEED_CLIENT_EMAIL, randomUUID())
      expect(response.statusCode).toBe(200)
    }

    expect(await activeSessions(SEED_CLIENT_EMAIL)).toHaveLength(total)
    expect(await revocationReasons(SEED_CLIENT_EMAIL)).not.toContain("device_limit_exceeded")
  })
})
