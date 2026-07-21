import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, test, vi } from "vitest"

import {
  loadMigrationFiles,
  migrationStatus,
  runMigrations,
  type MigrationClient,
  type MigrationPool,
} from "./migrate.js"

const createFakePool = (appliedVersions: readonly string[]) => {
  const clientQueries: string[] = []
  const client: MigrationClient = {
    query: vi.fn((text: string) => {
      clientQueries.push(text)
      return Promise.resolve(undefined)
    }),
    release: vi.fn(),
  }
  const pool: MigrationPool = {
    query: vi.fn(() =>
      Promise.resolve({ rows: appliedVersions.map((version) => ({ version })) }),
    ),
    connect: vi.fn(() => Promise.resolve(client)),
  }
  return { pool, client, clientQueries }
}

describe("loadMigrationFiles", () => {
  test("reads .sql files in deterministic order with checksums", async () => {
    const directory = await mkdtemp(join(tmpdir(), "boe-mig-"))
    await writeFile(join(directory, "002_b.sql"), "select 2;")
    await writeFile(join(directory, "001_a.sql"), "select 1;")
    await writeFile(join(directory, "ignore.txt"), "nope")

    const files = await loadMigrationFiles(directory)
    expect(files.map((file) => file.filename)).toEqual(["001_a.sql", "002_b.sql"])
    expect(files[0]?.version).toBe("001_a")
    expect(files[0]?.checksum).toMatch(/^[a-f0-9]{64}$/u)
  })
})

describe("runMigrations", () => {
  test("applies only pending migrations, each in a transaction", async () => {
    const { pool, client, clientQueries } = createFakePool([])
    const files = [
      { version: "001", filename: "001.sql", sql: "create table a ()", checksum: "x" },
      { version: "002", filename: "002.sql", sql: "create table b ()", checksum: "y" },
    ]

    const applied = await runMigrations(pool, files)
    expect(applied).toEqual(["001.sql", "002.sql"])
    expect(clientQueries).toContain("BEGIN")
    expect(clientQueries).toContain("COMMIT")
    expect(client.release).toHaveBeenCalledTimes(2)
  })

  test("skips already-applied migrations", async () => {
    const { pool, client } = createFakePool(["001"])
    const files = [
      { version: "001", filename: "001.sql", sql: "x", checksum: "x" },
      { version: "002", filename: "002.sql", sql: "y", checksum: "y" },
    ]

    expect(await runMigrations(pool, files)).toEqual(["002.sql"])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test("rolls back and rethrows when a migration fails", async () => {
    const client: MigrationClient = {
      query: vi.fn((text: string) =>
        text === "boom" ? Promise.reject(new Error("fail")) : Promise.resolve(undefined),
      ),
      release: vi.fn(),
    }
    const pool: MigrationPool = {
      query: vi.fn(() => Promise.resolve({ rows: [] })),
      connect: vi.fn(() => Promise.resolve(client)),
    }
    const files = [{ version: "001", filename: "001.sql", sql: "boom", checksum: "x" }]

    await expect(runMigrations(pool, files)).rejects.toThrow("fail")
    expect(client.query).toHaveBeenCalledWith("ROLLBACK")
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})

describe("canonical migration baseline (BE-024)", () => {
  test("db/migrations contains only the canonical >= 009 baseline (legacy 001-008 archived)", async () => {
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const files = await loadMigrationFiles(directory)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(file.version.slice(0, 3) >= "009").toBe(true)
    }
    expect(files.some((file) => file.version === "009_canonical_onboarding")).toBe(true)
  })

  test("legacy pre-canonical migrations 001-008 are retained in the archive only", async () => {
    const archive = fileURLToPath(new URL("../../db/migrations-archive", import.meta.url))
    const files = await loadMigrationFiles(archive)
    expect(files.map((file) => file.version.slice(0, 3)).sort()).toEqual([
      "001",
      "002",
      "003",
      "004",
      "005",
      "006",
      "007",
      "008",
    ])
  })
})

describe("migrationStatus", () => {
  test("marks applied and pending migrations", async () => {
    const { pool } = createFakePool(["001"])
    const files = [
      { version: "001", filename: "001.sql", sql: "x", checksum: "x" },
      { version: "002", filename: "002.sql", sql: "y", checksum: "y" },
    ]

    expect(await migrationStatus(pool, files)).toEqual([
      { filename: "001.sql", applied: true },
      { filename: "002.sql", applied: false },
    ])
  })
})
