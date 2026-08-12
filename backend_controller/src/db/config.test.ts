import { describe, expect, test } from "vitest"

import { parseDatabaseConfig } from "./config.js"

describe("parseDatabaseConfig", () => {
  test("parses the connection string and applies typed defaults", () => {
    const config = parseDatabaseConfig({ DATABASE_URL: "postgres://u:p@h:5432/db" })
    expect(config.connectionString).toBe("postgres://u:p@h:5432/db")
    expect(config.poolMax).toBe(10)
    expect(config.connectionTimeoutMs).toBe(3_000)
    expect(config.idleTimeoutMs).toBe(10_000)
    expect(config.statementTimeoutMs).toBe(10_000)
    expect(config.idleInTransactionTimeoutMs).toBe(15_000)
  })

  test("coerces the query and transaction bounds, and treats 0 as disabled", () => {
    const config = parseDatabaseConfig({
      DATABASE_URL: "postgres://h/db",
      DB_STATEMENT_TIMEOUT_MS: "2500",
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: "0",
    })
    expect(config.statementTimeoutMs).toBe(2_500)
    expect(config.idleInTransactionTimeoutMs).toBe(0)
  })

  test("coerces provided pool sizing and timeouts", () => {
    const config = parseDatabaseConfig({
      DATABASE_URL: "postgres://h/db",
      DB_POOL_MAX: "20",
      DB_CONNECTION_TIMEOUT_MS: "1000",
      DB_IDLE_TIMEOUT_MS: "0",
    })
    expect(config.poolMax).toBe(20)
    expect(config.connectionTimeoutMs).toBe(1_000)
    expect(config.idleTimeoutMs).toBe(0)
  })

  test("rejects a missing connection string", () => {
    expect(() => parseDatabaseConfig({})).toThrow()
  })

  test("rejects an out-of-range pool size", () => {
    expect(() =>
      parseDatabaseConfig({ DATABASE_URL: "postgres://h/db", DB_POOL_MAX: "0" }),
    ).toThrow()
  })
})
