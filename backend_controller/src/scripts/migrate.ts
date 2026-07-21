import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { parseDatabaseConfig } from "../db/config.js"
import { createPool } from "../db/pool.js"

export type MigrationFile = Readonly<{
  version: string
  filename: string
  sql: string
  checksum: string
}>

export interface MigrationClient {
  query: (text: string, values?: readonly unknown[]) => Promise<unknown>
  release: () => void
}

export interface MigrationPool {
  query: (text: string) => Promise<{ rows: ReadonlyArray<{ version: string }> }>
  connect: () => Promise<MigrationClient>
}

export type MigrationStatusRow = Readonly<{ filename: string; applied: boolean }>

const SCHEMA_MIGRATIONS_DDL =
  "CREATE TABLE IF NOT EXISTS schema_migrations (" +
  "version text PRIMARY KEY, filename text NOT NULL, checksum text NOT NULL, " +
  "applied_at timestamptz NOT NULL DEFAULT now())"

const DEFAULT_MIGRATIONS_DIR = "./db/migrations"

/** Read `.sql` migrations from a directory in deterministic filename order. */
export const loadMigrationFiles = async (
  directory: string,
): Promise<readonly MigrationFile[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort()

  const files: MigrationFile[] = []
  for (const filename of filenames) {
    const sql = await readFile(join(directory, filename), "utf8")
    files.push({
      version: filename.replace(/\.sql$/u, ""),
      filename,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    })
  }
  return files
}

const findAppliedVersions = async (pool: MigrationPool): Promise<ReadonlySet<string>> => {
  await pool.query(SCHEMA_MIGRATIONS_DDL)
  const result = await pool.query("SELECT version FROM schema_migrations ORDER BY version")
  return new Set(result.rows.map((row) => row.version))
}

/** Apply pending migrations, each in its own transaction; returns applied filenames. */
export const runMigrations = async (
  pool: MigrationPool,
  files: readonly MigrationFile[],
): Promise<readonly string[]> => {
  const applied = await findAppliedVersions(pool)
  const newlyApplied: string[] = []

  for (const file of files) {
    if (applied.has(file.version)) continue

    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(file.sql)
      await client.query(
        "INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)",
        [file.version, file.filename, file.checksum],
      )
      await client.query("COMMIT")
      newlyApplied.push(file.filename)
    } catch (error: unknown) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  return newlyApplied
}

export const migrationStatus = async (
  pool: MigrationPool,
  files: readonly MigrationFile[],
): Promise<readonly MigrationStatusRow[]> => {
  const applied = await findAppliedVersions(pool)
  return files.map((file) => ({ filename: file.filename, applied: applied.has(file.version) }))
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const command = process.argv[2] ?? "up"
  const directory = process.env.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS_DIR
  const pool = createPool(parseDatabaseConfig(process.env))

  try {
    const files = await loadMigrationFiles(directory)
    if (command === "status") {
      for (const row of await migrationStatus(pool, files)) {
        process.stdout.write(`${row.applied ? "applied" : "pending"} ${row.filename}\n`)
      }
    } else if (command === "up") {
      for (const filename of await runMigrations(pool, files)) {
        process.stdout.write(`applied ${filename}\n`)
      }
    } else {
      process.stderr.write("Usage: migrate [status|up]\n")
      process.exitCode = 1
    }
  } finally {
    await pool.end()
  }
}
