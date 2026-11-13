import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Kysely } from "kysely"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { Database } from "../../src/db/types.js"
import { releaseClosedAccountContacts, type ClientContactsDeps } from "../../src/domain/admin/clientContacts.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createEmailChangeRepository } from "../../src/repositories/emailChangeRepository.js"
import { createEmailVerificationRepository } from "../../src/repositories/emailVerificationRepository.js"
import { createIdentityLockRepository } from "../../src/repositories/identityLockRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createPasswordTokenRepository } from "../../src/repositories/passwordTokenRepository.js"
import { createUserContactRepository } from "../../src/repositories/userContactRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { CRYPTO_ENV } from "./passwordMailSupport.js"

const MIGRATION = "061_user_contact_history"
const ARGON_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA"

let container: StartedPostgreSqlContainer
let pool: Pool
let database: Kysely<Database>

interface Seeded {
  readonly id: string
  readonly email: string
  readonly phone: string
}

const seedUser = async (state: "active" | "closed", phone: string, password: boolean): Promise<Seeded> => {
  const email = `upgrade-${randomUUID()}@example.com`
  const id = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, closed_at, email_verification_state) " +
        "values ($1, $2, 'Upgrade Client', $3::user_account_state, now(), case when $3 = 'closed' then now() end, 'pending') returning id",
      [email, phone, state],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("user not seeded")
  if (password) await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [id, ARGON_HASH])
  await pool.query(
    "insert into password_credential_tokens (user_id, purpose, token_hash, token_key_version, expires_at, bound_email_revision, bound_credential_version) " +
      "values ($1, 'set', $2, 'tk1', now() + interval '10 minutes', 1, 0)",
    [id, randomBytes(32)],
  )
  return { id, email, phone }
}

const snapshot = async (): Promise<string> =>
  JSON.stringify(
    (
      await pool.query(
        "select (select json_agg(u order by u.id) from users u) as users, " +
          "(select json_agg(c order by c.user_id) from user_credentials c) as credentials, " +
          "(select json_agg(t order by t.id) from password_credential_tokens t) as tokens",
      )
    ).rows[0],
  )

const releaseDeps = (): ClientContactsDeps => ({
  passwordTokenRepository: createPasswordTokenRepository(),
  credentialRepository: createCredentialRepository(),
  authSessionRepository: createAuthSessionRepository(),
  userRepository: createUserRepository(),
  auditRepository: createAuditRepository(),
  outboxRepository: createOutboxRepository(),
  emailDeliveryRepository: createEmailDeliveryRepository(),
  identityLockRepository: createIdentityLockRepository(),
  userContactRepository: createUserContactRepository(),
  emailVerificationRepository: createEmailVerificationRepository(),
  emailChangeRepository: createEmailChangeRepository(),
  crypto: createCryptoContext(parseCryptoKeys(CRYPTO_ENV)),
  clock: () => new Date(),
  config: {
    tokenTtlMs: 600_000,
    maxAttempts: 5,
    requestCooldownMs: 60_000,
    passwordLinks: { clientUrl: "https://app.beonedge.test/reset-password", requireHttps: true },
    sesConfigurationSet: "boe-transactional",
  },
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
  database = createDatabase(pool)
  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
  const migrations = await loadMigrationFiles(directory)
  await runMigrations(pool, migrations.filter((migration) => migration.version < MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("contact history populated upgrade", () => {
  test("leaves every account untouched and keeps the previous release's lookups to one account per contact", async () => {
    const invitee = await seedUser("active", "+919876500001", false)
    const client = await seedUser("active", "+919876500002", true)
    const closed = await seedUser("closed", "+919876500003", true)
    const admin = await seedUser("active", "+919876500004", true)
    const before = await snapshot()

    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const migrations = await loadMigrationFiles(directory)
    await runMigrations(pool, migrations.filter((migration) => migration.version === MIGRATION))

    expect(await snapshot()).toBe(before)
    expect((await pool.query("select count(*)::int as c from user_contact_history")).rows[0]).toEqual({ c: 0 })
    await runMigrations(pool, migrations.filter((migration) => migration.version > MIGRATION))

    const unitOfWork = createUnitOfWork(database)
    await unitOfWork.execute((tx) =>
      releaseClosedAccountContacts(tx, releaseDeps(), {
        userId: closed.id,
        expectedVersion: 1,
        reasonCode: null,
        reasonDetail: null,
        actorUserId: admin.id,
        requestId: randomUUID(),
      }),
    )

    const users = createUserRepository()
    expect(await users.findLoginIdentityByEmail(database, closed.email)).toBeNull()
    expect(
      await unitOfWork.execute((tx) =>
        createApplicationRepository().findActiveConflict(tx, { emailNormalized: closed.email, phoneE164: closed.phone }),
      ),
    ).toBeNull()
    const reused = await unitOfWork.execute((tx) =>
      users.createAdminCreatedActive(tx, {
        emailNormalized: closed.email,
        phoneE164: closed.phone,
        fullName: "Recreated Client",
        activatedAt: new Date(),
      }),
    )
    expect((await users.findLoginIdentityByEmail(database, closed.email))?.user.id).toBe(reused.id)
    expect(
      (await pool.query("select id from users where email_normalized = $1 or phone_e164 = $2", [closed.email, closed.phone]))
        .rows,
    ).toEqual([{ id: reused.id }])

    for (const untouched of [invitee, client, admin]) {
      expect((await users.findLoginIdentityByEmail(database, untouched.email))?.user.id).toBe(untouched.id)
    }
    expect((await pool.query("select * from user_contact_history where user_id = $1", [closed.id])).rows).toMatchObject([
      { change_kind: "closed_release", previous_email_normalized: closed.email, previous_phone_e164: closed.phone },
    ])
  })
})
