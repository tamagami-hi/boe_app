import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool, PoolClient } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const MIGRATION = "069_client_erasure"

let container: StartedPostgreSqlContainer
let pool: Pool
let actorId: string
let phoneCounter = 0

interface Holder {
  readonly id: string
  readonly historyId: string
}

const nextPhone = (): string => {
  phoneCounter += 1
  return `+9198000${String(phoneCounter).padStart(5, "0")}`
}

const insertUser = async (verified: boolean): Promise<string> => {
  const row = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, email_verification_state, email_verified_at) " +
      "values ($1, $2, 'Migration Client', 'active', now(), $3, $4) returning id",
    [`migrate-${randomUUID()}@example.com`, nextPhone(), verified ? "verified" : "pending", verified ? new Date() : null],
  )
  const id = row.rows[0]?.id
  if (id === undefined) throw new Error("user not seeded")
  return id
}

const seedHolder = async (verified: boolean): Promise<Holder> => {
  const id = await insertUser(verified)
  const history = await pool.query<{ id: string }>(
    "insert into user_contact_history (user_id, change_kind, previous_email_normalized, previous_phone_e164, " +
      "new_email_normalized, new_phone_e164, actor_user_id, request_id, reason_detail) " +
      "values ($1, 'admin_correction', 'before@example.com', '+919800000001', 'after@example.com', '+919800000002', $2, $3, 'typo') returning id",
    [id, actorId, randomUUID()],
  )
  return { id, historyId: history.rows[0]?.id ?? "" }
}

const giveLedgerRow = async (userId: string): Promise<void> => {
  const one = async (text: string, values: readonly unknown[]): Promise<string> =>
    String((await pool.query<{ id: string }>(text, [...values])).rows[0]?.id)
  const fund = await one("insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id", [
    `m-${randomUUID().slice(0, 8)}`,
    actorId,
  ])
  const disclosure = await one(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'D', 'B', $2, now(), $3) returning id",
    [fund, randomBytes(32), actorId],
  )
  const version = await one(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, minimum_sip_paise, minimum_purchase_paise, " +
      "disclosure_version_id, terms_sha256, created_by_user_id) values ($1, 1, 'F', 'hybrid', 'O', 'moderate', 1, 1, $2, $3, $4) returning id",
    [fund, disclosure, randomBytes(32), actorId],
  )
  const order = await one(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'recorded_offline', 'accepted', 1000, now()) returning id",
    [userId, fund, version],
  )
  const payment = await one(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, 1000, 'succeeded', now()) returning id",
    [order, userId],
  )
  const allocation = await one(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, 1000, $4, $5) returning id",
    [order, userId, fund, actorId, randomUUID()],
  )
  await pool.query(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', 1000, 1000, '2025-01-15', $4, $5, 'recorded_offline_investment', 'admin', $6, $7)",
    [userId, fund, allocation, order, payment, actorId, randomUUID()],
  )
}

const historySnapshot = async (): Promise<string> =>
  JSON.stringify((await pool.query("select * from user_contact_history order by id")).rows)

const erasedEmail = (userId: string): string => `tombstone+${userId.replaceAll("-", "")}@invalid.example`

const inErasure = async <T>(userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query("select set_config('boe.erasing_user_id', $1, true)", [userId])
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

const rewrite = (client: PoolClient | Pool, holder: Holder, phones: readonly [string, string] = ["tombstone-previous", "tombstone-new"]) =>
  client.query(
    "update user_contact_history set previous_email_normalized = $2, new_email_normalized = $2, " +
      "previous_phone_e164 = $3, new_phone_e164 = $4 where id = $1",
    [holder.historyId, erasedEmail(holder.id), phones[0], phones[1]],
  )

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 5, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  const migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations.filter((migration) => migration.version < MIGRATION))
  actorId = await insertUser(true)
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("069 client erasure populated upgrade", () => {
  test("keeps every history row and leaves the append-only refusal in place outside the erase path", async () => {
    const verified = await seedHolder(true)
    const unverified = await seedHolder(false)
    const before = await historySnapshot()
    const migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
    await runMigrations(pool, migrations.filter((migration) => migration.version <= MIGRATION))
    expect(await historySnapshot()).toBe(before)

    await expect(pool.query("update user_contact_history set reason_detail = null where id = $1", [verified.historyId])).rejects.toThrow(
      /append-only/u,
    )
    await expect(pool.query("delete from user_contact_history where id = $1", [unverified.historyId])).rejects.toThrow(/append-only/u)
    await expect(pool.query("truncate user_contact_history")).rejects.toThrow(/append-only/u)
    await pool.query("update users set pii_tombstoned_at = now() where id = $1", [verified.id])
    await expect(rewrite(pool, verified)).rejects.toThrow(/append-only/u)
    await expect(
      inErasure(verified.id, (client) => client.query("delete from user_contact_history where id = $1", [verified.historyId])),
    ).rejects.toThrow(/append-only/u)
    await expect(inErasure(unverified.id, (client) => rewrite(client, verified))).rejects.toThrow(/append-only/u)
    await expect(
      inErasure(verified.id, (client) => client.query("truncate user_contact_history")),
    ).rejects.toThrow(/append-only/u)
    expect(await historySnapshot()).toBe(before)

    await pool.query(
      "insert into user_contact_history (user_id, change_kind, previous_email_normalized, previous_phone_e164, " +
        "new_email_normalized, new_phone_e164, actor_user_id, request_id) " +
        "values ($1, 'closed_release', 'x@example.com', '+919800000003', 'released+x@released.invalid', '+99900000000001', $2, $3)",
      [unverified.id, actorId, randomUUID()],
    )
  })

  test("lets only the erasing transaction rewrite a tombstoned client's contacts or delete a never-verified client's rows", async () => {
    const verified = await seedHolder(true)
    const live = await seedHolder(true)
    await expect(inErasure(live.id, (client) => rewrite(client, live))).rejects.toThrow(/append-only/u)
    await pool.query("update users set pii_tombstoned_at = now() where id = $1", [verified.id])
    await expect(inErasure(verified.id, (client) => rewrite(client, verified, ["tombstone", "tombstone-new"]))).rejects.toThrow(
      /append-only/u,
    )
    await expect(
      inErasure(verified.id, (client) =>
        client.query("update user_contact_history set reason_code = 'other' where id = $1", [verified.historyId]),
      ),
    ).rejects.toThrow(/append-only/u)

    await inErasure(verified.id, (client) => rewrite(client, verified))
    const rewritten = (await pool.query("select * from user_contact_history where id = $1", [verified.historyId])).rows[0] as Record<
      string,
      unknown
    >
    expect(rewritten).toMatchObject({
      previous_email_normalized: erasedEmail(verified.id),
      previous_phone_e164: "tombstone-previous",
      new_phone_e164: "tombstone-new",
      reason_detail: "typo",
      change_kind: "admin_correction",
    })

    const unverified = await seedHolder(false)
    const otherUnverified = await seedHolder(false)
    const invested = await seedHolder(false)
    await giveLedgerRow(invested.id)
    await expect(
      inErasure(unverified.id, (client) => client.query("delete from user_contact_history where id = $1", [otherUnverified.historyId])),
    ).rejects.toThrow(/append-only/u)
    await expect(
      inErasure(invested.id, (client) => client.query("delete from user_contact_history where id = $1", [invested.historyId])),
    ).rejects.toThrow(/append-only/u)
    await expect(
      inErasure(live.id, (client) => client.query("delete from user_contact_history where id = $1", [live.historyId])),
    ).rejects.toThrow(/append-only/u)
    await inErasure(unverified.id, (client) => client.query("delete from user_contact_history where user_id = $1", [unverified.id]))
    expect((await pool.query("select count(*)::int as c from user_contact_history where user_id = $1", [unverified.id])).rows[0]).toEqual({
      c: 0,
    })
    for (const kept of [live, otherUnverified, invested]) {
      expect(
        (await pool.query("select count(*)::int as c from user_contact_history where user_id = $1", [kept.id])).rows[0],
      ).toEqual({ c: 1 })
    }
  })
})
