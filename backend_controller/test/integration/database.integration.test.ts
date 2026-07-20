import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { sql } from "kysely"
import type { Kysely } from "kysely"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { Database } from "../../src/db/types.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let database: Kysely<Database>

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
}, 200_000)

afterAll(async () => {
  await database.destroy()
  await container.stop()
})

describe("PostgreSQL foundation (integration)", () => {
  test("executes a query through the typed pool", async () => {
    const result = await sql<{ one: number }>`select 1 as one`.execute(database)
    expect(result.rows[0]?.one).toBe(1)
  })

  test("commits work inside a unit-of-work transaction", async () => {
    const unitOfWork = createUnitOfWork(database)
    await unitOfWork.execute(async (transaction) => {
      await sql`create table committed_probe (id integer primary key)`.execute(transaction)
      await sql`insert into committed_probe (id) values (1)`.execute(transaction)
    })

    const rows = await sql<{ id: number }>`select id from committed_probe`.execute(database)
    expect(rows.rows).toEqual([{ id: 1 }])
  })

  test("rolls back the whole transaction when the operation throws", async () => {
    const unitOfWork = createUnitOfWork(database)
    await sql`create table rollback_probe (id integer primary key)`.execute(database)

    await expect(
      unitOfWork.execute(async (transaction) => {
        await sql`insert into rollback_probe (id) values (1)`.execute(transaction)
        throw new Error("forced rollback")
      }),
    ).rejects.toThrow("forced rollback")

    const rows = await sql<{ id: number }>`select id from rollback_probe`.execute(database)
    expect(rows.rows).toEqual([])
  })
})
