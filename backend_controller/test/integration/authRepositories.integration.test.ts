import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Kysely } from "kysely"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { UnitOfWork } from "../../src/db/database.js"
import type { UserId } from "../../src/db/repositories.js"
import type { Database } from "../../src/db/types.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let database: Kysely<Database>
let unitOfWork: UnitOfWork

const ARGON2ID_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaHZhbHVlaGVyZQ"

const insertActiveUser = async (email: string, phone: string): Promise<UserId> => {
  const result = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1, $2, 'Active User', 'active', now()) returning id",
    [email, phone],
  )
  return result.rows[0]?.id as UserId
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
  database = createDatabase(pool)
  unitOfWork = createUnitOfWork(database)
}, 200_000)

afterAll(async () => {
  await database.destroy()
  await container.stop()
})

describe("auth repositories (integration)", () => {
  const credentials = createCredentialRepository()
  const sessions = createAuthSessionRepository()

  test("creates a credential and reports existence", async () => {
    const userId = await insertActiveUser("cred@example.com", "+14155552001")
    expect(await unitOfWork.execute((tx) => credentials.exists(tx, userId))).toBe(false)
    await unitOfWork.execute((tx) => credentials.create(tx, userId, ARGON2ID_HASH))
    expect(await unitOfWork.execute((tx) => credentials.exists(tx, userId))).toBe(true)
  })

  test("creates a native session with its first refresh token and looks it up by hash", async () => {
    const userId = await insertActiveUser("sess@example.com", "+14155552002")
    const refreshHash = randomBytes(32)
    const created = await unitOfWork.execute((tx) =>
      sessions.createBearerSession(tx, {
        userId,
        channel: "native",
        deviceIdHash: randomBytes(32),
        refreshTokenHash: refreshHash,
        refreshKeyVersion: "rt1",
        sessionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    )
    expect(created.session.channel).toBe("native")
    expect(created.session.state).toBe("active")
    expect(created.refreshToken.generation).toBe("0")

    const located = await unitOfWork.execute((tx) => sessions.lockByRefreshTokenHash(tx, refreshHash))
    expect(located?.session.id).toBe(created.session.id)
    expect(await unitOfWork.execute((tx) => sessions.lockByRefreshTokenHash(tx, randomBytes(32)))).toBeNull()
  })

  test("revokes every active session and current refresh token for a user", async () => {
    const userId = await insertActiveUser("revoke@example.com", "+14155552003")
    await unitOfWork.execute((tx) =>
      sessions.createBearerSession(tx, {
        userId,
        channel: "native",
        deviceIdHash: randomBytes(32),
        refreshTokenHash: randomBytes(32),
        refreshKeyVersion: "rt1",
        sessionExpiresAt: new Date(Date.now() + 1_000_000),
        refreshExpiresAt: new Date(Date.now() + 1_000_000),
      }),
    )
    const result = await unitOfWork.execute((tx) =>
      sessions.revokeAllForUser(tx, { userId, reason: "user_suspended", now: new Date() }),
    )
    expect(result.revokedSessionCount).toBe(1)
    expect(result.revokedRefreshTokenCount).toBe(1)

    const remaining = await pool.query<{ c: number }>(
      "select count(*)::int as c from auth_sessions where user_id = $1 and state = 'active'",
      [userId],
    )
    expect(remaining.rows[0]?.c).toBe(0)
  })
})
