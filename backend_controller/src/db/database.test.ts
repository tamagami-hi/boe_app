import { Kysely } from "kysely"
import pg from "pg"
import { describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork } from "./database.js"
import { createPool } from "./pool.js"

const config = {
  connectionString: "postgres://user:pass@localhost:5432/db",
  poolMax: 7,
  connectionTimeoutMs: 1_500,
  idleTimeoutMs: 2_500,
} as const

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
