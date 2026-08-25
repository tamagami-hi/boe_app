import { Kysely } from "kysely"
import pg from "pg"
import { describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork } from "./database.js"
import { createPool } from "./pool.js"

describe("PostgreSQL date parser", () => {
  test("parses date columns to UTC-midnight Date objects", () => {
    const parser = pg.types.getTypeParser(pg.types.builtins.DATE)
    const parsed = parser("2026-09-05")
    expect(parsed.toISOString()).toBe("2026-09-05T00:00:00.000Z")
  })
})

const config = {
  connectionString: "postgres://user:pass@localhost:5432/db",
  poolMax: 7,
  connectionTimeoutMs: 1_500,
  idleTimeoutMs: 2_500,
} as const

describe("pool settings", () => {
  test("schemaToolPoolSettings drops statement and idle-in-transaction timeouts", async () => {
    const { schemaToolPoolSettings } = await import("./pool.js")
    const settings = schemaToolPoolSettings({
      connectionString: "postgres://user:pass@localhost:5432/db",
      poolMax: 5,
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 2_000,
      statementTimeoutMs: 10_000,
      idleInTransactionTimeoutMs: 5_000,
    })
    expect(settings).not.toHaveProperty("statementTimeoutMs")
    expect(settings).not.toHaveProperty("idleInTransactionTimeoutMs")
    expect(settings.connectionString).toBe("postgres://user:pass@localhost:5432/db")
  })

  test("createPool omits timeout options when they are zero or absent", async () => {
    const pool = createPool({
      connectionString: "postgres://user:pass@localhost:5432/db",
      poolMax: 5,
      connectionTimeoutMs: 1_000,
      idleTimeoutMs: 2_000,
    })
    expect(pool.options).not.toHaveProperty("statement_timeout")
    expect(pool.options).not.toHaveProperty("idle_in_transaction_session_timeout")
    await pool.end()
  })
})

describe("database foundation construction", () => {
  test("createPool builds a lazy pg pool that has not connected", async () => {
    const pool = createPool(config)
    try {
      expect(pool).toBeInstanceOf(pg.Pool)
      expect(pool.totalCount).toBe(0)
    } finally {
      await pool.end()
    }
  })

  test("createDatabase builds a Kysely instance and a unit of work", async () => {
    const pool = createPool(config)
    const database = createDatabase(pool)
    try {
      expect(database).toBeInstanceOf(Kysely)
      const unitOfWork = createUnitOfWork(database)
      expect(typeof unitOfWork.execute).toBe("function")
    } finally {
      await database.destroy()
    }
  })
})
