import { pathToFileURL } from "node:url"

import { parseDatabaseConfig } from "../db/config.js"
import { createPool } from "../db/pool.js"

export type DatabaseCheck = Readonly<{ ok: boolean }>

export interface CheckableConnection {
  query: (text: string) => Promise<unknown>
}

/** Report whether the database answers a trivial query. Never throws. */
export const checkDatabase = async (
  connection: CheckableConnection,
): Promise<DatabaseCheck> => {
  try {
    await connection.query("SELECT 1")
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const pool = createPool(parseDatabaseConfig(process.env))
  let check: DatabaseCheck
  try {
    check = await checkDatabase(pool)
  } finally {
    await pool.end()
  }
  process.stdout.write(`${JSON.stringify(check)}\n`)
  process.exitCode = check.ok ? 0 : 1
}
