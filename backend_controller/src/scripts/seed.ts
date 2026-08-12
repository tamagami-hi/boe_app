import { pathToFileURL } from "node:url"

import { parseDatabaseConfig } from "../db/config.js"
import { createPool, schemaToolPoolSettings } from "../db/pool.js"
import { buildSeedStatements } from "../db/seedCatalog.js"

export interface SeedClient {
  query: (text: string, values?: readonly unknown[]) => Promise<unknown>
  release: () => void
}

export interface SeedPool {
  connect: () => Promise<SeedClient>
}

/**
 * Apply the idempotent bootstrap catalog in one transaction. Returns the number
 * of statements executed. A repeated run is a no-op because every statement is
 * `ON CONFLICT DO NOTHING`.
 */
export const runSeed = async (pool: SeedPool): Promise<number> => {
  const statements = buildSeedStatements()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const statement of statements) {
      await client.query(statement.text, statement.values)
    }
    await client.query("COMMIT")
  } catch (error: unknown) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
  return statements.length
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const pool = createPool(schemaToolPoolSettings(parseDatabaseConfig(process.env)))
  try {
    const applied = await runSeed(pool)
    process.stdout.write(`seeded ${String(applied)} catalog statements\n`)
  } finally {
    await pool.end()
  }
}
