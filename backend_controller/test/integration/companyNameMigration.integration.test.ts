import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations, type MigrationFile } from "../../src/scripts/migrate.js"

const MIGRATION = "071_correct_company_name"
const WRONG_NAME = "BeOnEdge Financial Services Pvt. Ltd."

type ContentRow = Readonly<{
  id: string
  content_key: string
  kind: string
  version: number
  title: string
  body: string
  payload: Record<string, unknown>
  state: string
  archived_at: Date | null
}>

let container: StartedPostgreSqlContainer
let pool: Pool
let migrations: readonly MigrationFile[]
let untouchedBefore: string

const charterPayload = {
  title: "Investor Charter",
  sections: [{ heading: "Your rights", items: ["Clear disclosures."] }],
  contact: { email: "support@beonedge.example", phone: "+91-80-1234-5678", hours: "Monday - Friday", address: WRONG_NAME },
}

const insertContent = async (
  values: Readonly<{ key: string; kind: string; version: number; state: string; payload: Record<string, unknown> }>,
): Promise<void> => {
  await pool.query(
    "insert into content_items (content_key, kind, version, title, body, payload, state, published_at) " +
      "values ($1, $2, $3, $4, 'Body text.', $5::jsonb, $6, case when $6 = 'published' then now() end)",
    [values.key, values.kind, values.version, `Title ${values.key}`, JSON.stringify(values.payload), values.state],
  )
}

const rowsOf = async (key: string): Promise<readonly ContentRow[]> =>
  (await pool.query<ContentRow>("select * from content_items where content_key = $1 order by version", [key])).rows

const untouched = async (): Promise<string> =>
  JSON.stringify(
    (await pool.query("select * from content_items where content_key <> 'investor-charter' order by content_key, version")).rows,
  )

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 4, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations.filter((migration) => migration.version < MIGRATION))

  await insertContent({ key: "investor-charter", kind: "legal_disclosure", version: 1, state: "published", payload: charterPayload })
  await insertContent({ key: "investor-charter", kind: "legal_disclosure", version: 2, state: "draft", payload: charterPayload })
  await insertContent({
    key: "grievance-redressal",
    kind: "static_page",
    version: 1,
    state: "published",
    payload: { contact: { email: "grievance@beonedge.example", address: `${WRONG_NAME}, Kolkata` } },
  })
  await insertContent({
    key: "disclosures",
    kind: "legal_disclosure",
    version: 1,
    state: "published",
    payload: { contact: { address: WRONG_NAME } },
  })

  untouchedBefore = await untouched()
  await runMigrations(pool, migrations.filter((migration) => migration.version === MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("company name correction populated upgrade", () => {
  test("publishes a corrected investor charter and keeps the old version archived", async () => {
    const rows = await rowsOf("investor-charter")
    expect(rows.map((row) => [row.version, row.state])).toEqual([
      [1, "archived"],
      [2, "draft"],
      [3, "published"],
    ])
    const [original, draft, corrected] = rows
    expect(original?.payload).toEqual(charterPayload)
    expect(original?.archived_at).not.toBeNull()
    expect(draft?.payload).toEqual(charterPayload)
    expect(corrected?.payload).toEqual({ ...charterPayload, contact: { ...charterPayload.contact, address: "BeOnEdge LLP" } })
    expect([corrected?.kind, corrected?.title, corrected?.body]).toEqual([original?.kind, original?.title, original?.body])
  })

  test("leaves a document with another address, and every other document, untouched", async () => {
    expect(await untouched()).toBe(untouchedBefore)
  })
})
