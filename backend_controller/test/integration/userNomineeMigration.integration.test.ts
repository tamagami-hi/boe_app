import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Kysely } from "kysely"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork, type UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { UserId } from "../../src/db/repositories.js"
import type { Database } from "../../src/db/types.js"
import { createAdminOversightRepository } from "../../src/repositories/adminOversightRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const MIGRATION = "063_user_nominee"
const ARGON_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA"
const NOMINEE_COLUMNS = ["nominee_name", "nominee_relation", "nominee_version"]
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}]/u
const LAST_CODE_POINT = 0x10ffff

type Row = Record<string, unknown>

let container: StartedPostgreSqlContainer
let pool: Pool
let database: Kysely<Database>
let unitOfWork: UnitOfWork
let phoneCounter = 0

const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415556${String(phoneCounter).padStart(4, "0")}`
}

const seedUser = async (state: "invited" | "active" | "suspended" | "closed", password: boolean): Promise<string> => {
  const id = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, suspended_at, closed_at, email_verification_state) " +
        "values ($1, $2, 'Upgrade Client', $3::user_account_state, case when $3 = 'invited' then null else now() end, " +
        "case when $3 = 'suspended' then now() end, case when $3 = 'closed' then now() end, 'pending') returning id",
      [`nominee-upgrade-${randomUUID()}@example.com`, nextPhone(), state],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("user not seeded")
  if (password) await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [id, ARGON_HASH])
  return id
}

const usersById = async (): Promise<Row[]> => (await pool.query<Row>("select * from users order by id")).rows

const withoutNominee = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).filter(([column]) => !NOMINEE_COLUMNS.includes(column)))

const nomineeOf = async (userId: string): Promise<Row> =>
  (await pool.query<Row>("select nominee_name, nominee_relation, version from users where id = $1", [userId])).rows[0] ?? {}

const invisibleCharacters = (): string[] => {
  const found: string[] = []
  for (let codePoint = 0; codePoint <= LAST_CODE_POINT; codePoint += 1) {
    const character = String.fromCodePoint(codePoint)
    if (INVISIBLE.test(character)) found.push(character)
  }
  return found
}

const migrationsFrom = async (predicate: (version: string) => boolean) => {
  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
  return (await loadMigrationFiles(directory)).filter((migration) => predicate(migration.version))
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 5, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  database = createDatabase(pool)
  unitOfWork = createUnitOfWork(database)
  await runMigrations(pool, await migrationsFrom((version) => version < MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("nominee populated upgrade", () => {
  test("leaves every user row untouched and keeps the previous release's user reads and writes working", async () => {
    const invited = await seedUser("invited", false)
    const client = await seedUser("active", true)
    const suspended = await seedUser("suspended", true)
    const closed = await seedUser("closed", true)
    const before = await usersById()
    expect(before).toHaveLength(4)

    await runMigrations(pool, await migrationsFrom((version) => version === MIGRATION))

    const after = await usersById()
    expect(after.map(withoutNominee)).toEqual(before)
    for (const row of after) expect([row.nominee_name, row.nominee_relation, row.nominee_version]).toEqual([null, null, 0])
    await runMigrations(pool, await migrationsFrom((version) => version > MIGRATION))

    await pool.query("update users set nominee_name = 'Meera Rao', nominee_relation = 'Spouse' where id = $1", [client])
    const users = createUserRepository()
    const oversight = createAdminOversightRepository()
    const clientEmail = String(before.find((row) => row.id === client)?.email_normalized)

    expect((await users.findLoginIdentityByEmail(database, clientEmail))?.user.id).toBe(client)
    const moved = await unitOfWork.execute(async (tx) => {
      const locked = await users.lockById(tx, client as UserId)
      if (locked === null) throw new Error("client missing")
      return users.updatePhone(tx, { userId: client as UserId, phoneE164: nextPhone(), expectedVersion: locked.version, now: new Date() })
    })
    expect(moved?.version).toBe("2")
    const suspendedNow = await unitOfWork.execute(async (tx) => {
      const locked = await oversight.lockUser(tx, client)
      return oversight.setUserAccountState(tx, { userId: client, state: "suspended", now: new Date(), expectedVersion: Number(locked?.version) })
    })
    expect(suspendedNow?.account_state).toBe("suspended")
    expect(await nomineeOf(client)).toEqual({ nominee_name: "Meera Rao", nominee_relation: "Spouse", version: "3" })

    const created = await unitOfWork.execute((tx) =>
      users.createAdminCreatedActive(tx, {
        emailNormalized: `nominee-created-${randomUUID()}@example.com`,
        phoneE164: nextPhone(),
        fullName: "Created After Upgrade",
        activatedAt: new Date(),
      }),
    )
    expect(await nomineeOf(created.id)).toEqual({ nominee_name: null, nominee_relation: null, version: "1" })
    for (const untouched of [invited, suspended, closed]) {
      expect((await pool.query<Row>("select * from users where id = $1", [untouched])).rows[0]).toMatchObject(
        before.find((row) => row.id === untouched) ?? {},
      )
    }
  })

  test("refuses a half nominee, untrimmed, control, invisible or letterless text and over-long values in the database", async () => {
    const client = await seedUser("active", true)
    const refused = [
      ["Meera Rao", null],
      [null, "Spouse"],
      [" Meera Rao", "Spouse"],
      ["Meera\u0007Rao", "Spouse"],
      ["Meera Rao", "Sp\u0085ouse"],
      ["M", "Spouse"],
      ["x".repeat(121), "Spouse"],
      ["Meera Rao", "x".repeat(121)],
      ["-- .", "Spouse"],
      ["Meera Rao", "!!"],
      ...invisibleCharacters().flatMap((character) => [
        [`Meera${character}Rao`, "Spouse"],
        ["Meera Rao", `Spo${character}use`],
      ]),
    ]
    for (const [name, relation] of refused) {
      await expect(
        pool.query("update users set nominee_name = $2, nominee_relation = $3 where id = $1", [client, name, relation]),
        `${String(name)} / ${String(relation)}`,
      ).rejects.toThrow(/users_nominee/u)
    }
    await pool.query("update users set nominee_name = $2, nominee_relation = $3 where id = $1", [client, "x".repeat(120), "x".repeat(120)])
    expect((await nomineeOf(client)).nominee_name).toBe("x".repeat(120))
    await pool.query("update users set nominee_name = $2, nominee_relation = $3 where id = $1", [client, "सीता देवी", "पत्नी"])
    expect(await nomineeOf(client)).toMatchObject({ nominee_name: "सीता देवी", nominee_relation: "पत्नी" })
  })

  test("tombstoning a user in the database clears both nominee fields", async () => {
    const client = await seedUser("closed", true)
    await pool.query("update users set nominee_name = 'Meera Rao', nominee_relation = 'Spouse' where id = $1", [client])

    await pool.query("update users set pii_tombstoned_at = now() where id = $1", [client])
    expect(await nomineeOf(client)).toMatchObject({ nominee_name: null, nominee_relation: null })

    await pool.query("update users set nominee_name = 'Meera Rao', nominee_relation = 'Spouse' where id = $1", [client])
    expect(await nomineeOf(client)).toMatchObject({ nominee_name: null, nominee_relation: null })
  })
})
