import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool, PoolClient } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { hashPassword } from "../../src/auth/passwordHasher.js"
import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import type { CryptoContext } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import type { UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { redeemPasswordToken, type PasswordCredentialDeps } from "../../src/domain/auth/passwordCredential.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { createPasswordTokenRepository } from "../../src/repositories/passwordTokenRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const BINDING_MIGRATION = "054_password_link_binding"
const BINDING_MIGRATION_FILE = "054_password_link_binding.sql"
const HOUR_MS = 3_600_000
const COOLDOWN_MS = 60_000
const NEW_PASSWORD = "another correct horse battery staple"

const RELEASE_169D1BE_SQL = {
  tokenCreate:
    'insert into "password_credential_tokens" ("user_id", "purpose", "token_hash", "token_key_version", "expires_at") values ($1, $2, $3, $4, $5) returning *',
  tokenLockActiveByHash:
    'select * from "password_credential_tokens" where "token_hash" = $1 and "consumed_at" is null for update',
  tokenLatestCreatedAt:
    'select "created_at" from "password_credential_tokens" where "user_id" = $1 order by "created_at" desc limit $2',
  tokenConsumeActive:
    'update "password_credential_tokens" set "consumed_at" = $1 where "user_id" = $2 and "consumed_at" is null',
  tokenConsume:
    'update "password_credential_tokens" set "consumed_at" = $1 where "id" = $2 and "consumed_at" is null',
  userLockById: 'select * from "users" where "id" = $1 for update',
} as const

const NEW_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ["email_revision"],
  password_credential_tokens: ["bound_email_revision", "bound_credential_version"],
}

type Row = Record<string, unknown>

interface Account {
  readonly id: string
  readonly rawToken: string
}

let container: StartedPostgreSqlContainer
let pool: Pool
let unitOfWork: UnitOfWork
let crypto: CryptoContext
let passwordHash: string
let phoneCounter = 0
let clockOffsetMs = 0

const accounts = new Map<string, Account>()
let previousReleaseToken = ""
let dataBefore: Record<string, Row[]>
let schemaBefore: Record<string, string[]>
let dataAfter: Record<string, Row[]>

const passwordTokenRepository = createPasswordTokenRepository()
const credentialRepository = createCredentialRepository()
const userRepository = createUserRepository()
const key = (): string => randomBytes(32).toString("base64")
const clock = (): Date => new Date(Date.now() + clockOffsetMs)

const deps = (): PasswordCredentialDeps => ({
  passwordTokenRepository,
  credentialRepository,
  authSessionRepository: createAuthSessionRepository(),
  userRepository,
  auditRepository: createAuditRepository(),
  crypto,
  clock,
  config: { tokenTtlMs: HOUR_MS, maxAttempts: 5, requestCooldownMs: COOLDOWN_MS },
})

const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415558${String(phoneCounter).padStart(4, "0")}`
}

const seedAccount = async (
  label: string,
  options: {
    state?: "active" | "suspended"
    credentialVersion?: number
    token?: { purpose: "set" | "reset"; consumed?: boolean; expired?: boolean; attempts?: number }
    extraConsumedToken?: boolean
  },
): Promise<Account> => {
  const id = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, suspended_at) " +
        "values ($1, $2, 'Ada Lovelace', $3::user_account_state, now(), case when $3 = 'suspended' then now() end) returning id",
      [`${label}-${randomUUID()}@example.com`, nextPhone(), options.state ?? "active"],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error(`user not created for ${label}`)
  if (options.credentialVersion !== undefined) {
    await pool.query("insert into user_credentials (user_id, password_hash, version) values ($1, $2, $3)", [
      id,
      passwordHash,
      options.credentialVersion,
    ])
  }
  const insertToken = async (purpose: "set" | "reset", consumed: boolean, expired: boolean, attempts: number) => {
    const rawToken = `legacy-${label}-${randomUUID()}-${randomUUID()}`
    const now = Date.now()
    await pool.query(
      "insert into password_credential_tokens (user_id, purpose, token_hash, token_key_version, attempt_count, " +
        "expires_at, consumed_at, created_at) values ($1, $2::password_token_purpose, $3, 'tk1', $4, $5, $6, $7)",
      [
        id,
        purpose,
        crypto.hashToken(rawToken).hash,
        attempts,
        new Date(expired ? now - HOUR_MS : now + HOUR_MS),
        consumed ? new Date(now - 90 * 60_000) : null,
        new Date(now - 2 * HOUR_MS),
      ],
    )
    return rawToken
  }
  if (options.extraConsumedToken === true) await insertToken("set", true, false, 0)
  const rawToken =
    options.token === undefined
      ? ""
      : await insertToken(
          options.token.purpose,
          options.token.consumed === true,
          options.token.expired === true,
          options.token.attempts ?? 0,
        )
  const account = { id, rawToken }
  accounts.set(label, account)
  return account
}

const withoutNewColumns = (table: string, row: Row): Row => {
  const copy = { ...row }
  for (const column of NEW_COLUMNS[table] ?? []) Reflect.deleteProperty(copy, column)
  return copy
}

const dataSnapshot = async (dropNewColumns: boolean): Promise<Record<string, Row[]>> => {
  const tables = (
    await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' " +
        "and table_type = 'BASE TABLE' and table_name <> 'schema_migrations' order by table_name",
    )
  ).rows
  const snapshot: Record<string, Row[]> = {}
  for (const { table_name: table } of tables) {
    const rows = (await pool.query<{ row: Row }>(`select to_jsonb(t) as row from "${table}" t`)).rows.map(({ row }) =>
      dropNewColumns ? withoutNewColumns(table, row) : row,
    )
    snapshot[table] = rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  }
  return snapshot
}

const schemaSnapshot = async (): Promise<Record<string, string[]>> => ({
  columns: (
    await pool.query<Row>(
      "select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns " +
        "where table_schema = 'public' order by table_name, ordinal_position",
    )
  ).rows.map((row) => `${String(row.table_name)}.${String(row.column_name)} ${String(row.data_type)} ${String(row.is_nullable)} ${String(row.column_default)}`),
  constraints: (
    await pool.query<Row>(
      "select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint " +
        "where connamespace = 'public'::regnamespace order by 1, 2",
    )
  ).rows.map((row) => `${String(row.table_name)}.${String(row.conname)} ${String(row.definition)}`),
  indexes: (
    await pool.query<Row>("select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2")
  ).rows.map((row) => `${String(row.tablename)}.${String(row.indexname)} ${String(row.indexdef)}`),
  triggers: (
    await pool.query<Row>(
      "select event_object_table, trigger_name from information_schema.triggers where trigger_schema = 'public' order by 1, 2",
    )
  ).rows.map((row) => `${String(row.event_object_table)}.${String(row.trigger_name)}`),
})

const tokenOf = async (rawToken: string): Promise<Row> =>
  (
    await pool.query<Row>("select * from password_credential_tokens where token_hash = $1", [
      crypto.hashToken(rawToken).hash,
    ])
  ).rows[0] ?? {}

const inPreviousRelease = async <T>(commit: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query("begin")
    try {
      const result = await work(client)
      await client.query(commit ? "commit" : "rollback")
      return result
    } catch (error) {
      await client.query("rollback")
      throw error
    }
  } finally {
    client.release()
  }
}

const accountOf = (label: string): Account => {
  const account = accounts.get(label)
  if (account === undefined) throw new Error(`account ${label} was not seeded`)
  return account
}

const redeem = (rawToken: string) =>
  unitOfWork.execute((tx) =>
    redeemPasswordToken(tx, deps(), { rawToken, newPassword: NEW_PASSWORD, requestId: randomUUID() }),
  )

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
  unitOfWork = createUnitOfWork(createDatabase(pool))
  crypto = createCryptoContext(
    parseCryptoKeys({
      CRYPTO_TOKEN_HASH_KEY: key(),
      CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
      CRYPTO_CONSENT_IP_HMAC_KEY: key(),
      CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
      CRYPTO_RECIPIENT_HMAC_KEY: key(),
      CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
      CRYPTO_RECIPIENT_ENC_KEY: key(),
      CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
    }),
  )
  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
  const migrations = await loadMigrationFiles(directory)
  await runMigrations(pool, migrations.filter((migration) => migration.version < BINDING_MIGRATION))
  passwordHash = await hashPassword("the password a client already has")

  await seedAccount("live-set", { token: { purpose: "set" }, extraConsumedToken: true })
  await seedAccount("live-reset", { credentialVersion: 3, token: { purpose: "reset", attempts: 2 }, extraConsumedToken: true })
  await seedAccount("live-reset-no-password", { token: { purpose: "reset" } })
  await seedAccount("live-reset-suspended", { state: "suspended", credentialVersion: 1, token: { purpose: "reset" } })
  await seedAccount("expired-unconsumed", { credentialVersion: 1, token: { purpose: "reset", expired: true } })
  await seedAccount("consumed-unexpired", { credentialVersion: 2, token: { purpose: "reset", consumed: true } })
  await seedAccount("window", { credentialVersion: 1 })
  dataBefore = await dataSnapshot(false)
  schemaBefore = await schemaSnapshot()
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("password link binding populated upgrade", () => {
  test("adds only the revision and binding columns and binds exactly the live tokens, leaving every other row as recorded", async () => {
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const migrations = await loadMigrationFiles(directory)

    const applied = await runMigrations(pool, migrations.filter((migration) => migration.version === BINDING_MIGRATION))

    expect(applied).toEqual([BINDING_MIGRATION_FILE])
    dataAfter = await dataSnapshot(false)
    expect(await dataSnapshot(true)).toEqual(dataBefore)
    const schemaAfter = await schemaSnapshot()
    for (const kind of ["columns", "constraints", "indexes", "triggers"] as const) {
      const before = schemaBefore[kind] ?? []
      const after = schemaAfter[kind] ?? []
      expect(before.filter((entry) => !after.includes(entry))).toEqual([])
      const added = after.filter((entry) => !before.includes(entry))
      if (kind === "columns") {
        expect(added.sort()).toEqual([
          "password_credential_tokens.bound_credential_version bigint YES null",
          "password_credential_tokens.bound_email_revision bigint YES null",
          "users.email_revision bigint NO 1",
        ])
      } else if (kind === "constraints") {
        expect(added.map((entry) => entry.split(" ")[0]).sort()).toEqual([
          "password_credential_tokens.password_credential_tokens_binding_pair",
          "password_credential_tokens.password_credential_tokens_binding_range",
          "users.users_email_revision_positive",
        ])
      } else {
        expect(added).toEqual([])
      }
    }
    const revisions = await pool.query<{ email_revision: string }>("select distinct email_revision from users")
    expect(revisions.rows).toEqual([{ email_revision: "1" }])
  })

  test("binds each live token to its account's current state and leaves consumed and expired tokens unbound", async () => {
    const binding = async (label: string) => {
      const row = await tokenOf(accountOf(label).rawToken)
      return [row.bound_email_revision, row.bound_credential_version]
    }

    expect(await binding("live-set")).toEqual(["1", "0"])
    expect(await binding("live-reset")).toEqual(["1", "3"])
    expect(await binding("live-reset-no-password")).toEqual(["1", "0"])
    expect(await binding("live-reset-suspended")).toEqual(["1", "1"])
    expect(await binding("expired-unconsumed")).toEqual([null, null])
    expect(await binding("consumed-unexpired")).toEqual([null, null])
    const consumedSet = await pool.query(
      "select 1 from password_credential_tokens where user_id = $1 and consumed_at is not null " +
        "and (bound_email_revision is not null or bound_credential_version is not null)",
      [accountOf("live-set").id],
    )
    expect(consumedSet.rowCount).toBe(0)
  })

  test("running the backfill statement again changes no row", async () => {
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const sql = await readFile(`${directory}/${BINDING_MIGRATION_FILE}`, "utf8")
    const backfill = sql.slice(sql.indexOf("UPDATE password_credential_tokens"))

    const rerun = await pool.query(backfill)

    expect(rerun.rowCount).toBe(0)
    expect(await dataSnapshot(false)).toEqual(dataAfter)
  })

  test("the previous release's token statements run against the upgraded schema and write an unbound token", async () => {
    const window = accountOf("window")
    const live = accountOf("live-reset")
    const minted = crypto.generateVerificationToken()
    const now = new Date()

    const outcome = await inPreviousRelease(true, async (client) => {
      const locked = await client.query<Row>(RELEASE_169D1BE_SQL.userLockById, [window.id])
      const latest = await client.query<Row>(RELEASE_169D1BE_SQL.tokenLatestCreatedAt, [window.id, 1])
      await client.query(RELEASE_169D1BE_SQL.tokenConsumeActive, [now, window.id])
      const created = await client.query<Row>(RELEASE_169D1BE_SQL.tokenCreate, [
        window.id,
        "reset",
        minted.hash,
        minted.keyVersion,
        new Date(now.getTime() + HOUR_MS),
      ])
      return { locked: locked.rows[0], latest: latest.rows, created: created.rows[0] }
    })

    expect(outcome.locked).toMatchObject({ id: window.id, email_revision: "1", account_state: "active" })
    expect(outcome.latest).toEqual([])
    expect(outcome.created).toMatchObject({ user_id: window.id, bound_email_revision: null, bound_credential_version: null })

    const looked = await inPreviousRelease(false, async (client) => {
      const found = await client.query<Row>(RELEASE_169D1BE_SQL.tokenLockActiveByHash, [crypto.hashToken(live.rawToken).hash])
      const consumed = await client.query(RELEASE_169D1BE_SQL.tokenConsume, [now, found.rows[0]?.id])
      const cooldown = await client.query<Row>(RELEASE_169D1BE_SQL.tokenLatestCreatedAt, [live.id, 1])
      return { found: found.rows[0], consumed: consumed.rowCount, cooldown: cooldown.rows }
    })

    expect(looked.found).toMatchObject({ user_id: live.id, bound_email_revision: "1", bound_credential_version: "3" })
    expect(looked.consumed).toBe(1)
    expect(looked.cooldown).toHaveLength(1)
    previousReleaseToken = minted.token
  })

  test("the new release keeps every backfilled live link working, and refuses a link the previous release wrote after the upgrade", async () => {
    expect(await redeem(accountOf("live-set").rawToken)).toMatchObject({ kind: "redeemed", purpose: "set" })
    expect(await redeem(accountOf("live-reset").rawToken)).toMatchObject({ kind: "redeemed", purpose: "reset" })
    expect(await redeem(accountOf("live-reset-no-password").rawToken)).toMatchObject({ kind: "redeemed", purpose: "reset" })
    expect((await redeem(accountOf("live-reset-suspended").rawToken)).kind).toBe("inactive_account")
    expect((await redeem(accountOf("expired-unconsumed").rawToken)).kind).toBe("expired")
    expect((await redeem(accountOf("consumed-unexpired").rawToken)).kind).toBe("unknown_token")
    expect((await redeem(previousReleaseToken)).kind).toBe("unbound")
  })
})
