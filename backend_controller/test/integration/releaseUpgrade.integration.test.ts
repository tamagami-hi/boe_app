import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import type { CryptoContext } from "../../src/crypto/context.js"
import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { CRYPTO_ENV } from "./passwordMailSupport.js"

const RELEASED_SCHEMA = "051_maturity_settlement"
const HOUR_MS = 3_600_000
const DURABLE_EXPIRY = "9999-12-31T00:00:00Z"

type Row = Record<string, unknown>
type Snapshot = ReadonlyMap<string, { readonly columns: readonly string[]; readonly rows: readonly string[] }>

let container: StartedPostgreSqlContainer
let pool: Pool
let crypto: CryptoContext
let before: Snapshot
let phoneCounter = 0
const ids = new Map<string, string>()

const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415557${String(phoneCounter).padStart(4, "0")}`
}

const one = async (text: string, values: readonly unknown[] = []): Promise<string> => {
  const id = (await pool.query<{ id: string }>(text, [...values])).rows[0]?.id
  if (id === undefined) throw new Error(`no row returned by: ${text.slice(0, 60)}`)
  return id
}

const idOf = (label: string): string => {
  const id = ids.get(label)
  if (id === undefined) throw new Error(`nothing seeded as ${label}`)
  return id
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable((value as Row)[key])]),
  )
}

const snapshot = async (tables?: readonly string[]): Promise<Snapshot> => {
  const names =
    tables ??
    (
      await pool.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' " +
          "and table_name <> 'schema_migrations' order by table_name",
      )
    ).rows.map((row) => row.table_name)
  const result = new Map<string, { columns: string[]; rows: string[] }>()
  for (const name of names) {
    const columns = (
      await pool.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by column_name",
        [name],
      )
    ).rows.map((row) => row.column_name)
    const rows = (await pool.query<{ row: Row }>(`select to_jsonb(t) as row from "${name}" t`)).rows
    result.set(name, { columns, rows: rows.map((row) => JSON.stringify(stable(row.row))).sort() })
  }
  return result
}

const restrictTo = (rows: readonly string[], columns: readonly string[]): string[] =>
  rows
    .map((text) => {
      const row = JSON.parse(text) as Row
      return JSON.stringify(stable(Object.fromEntries(columns.map((column) => [column, row[column]]))))
    })
    .sort()

const seedPeople = async (): Promise<void> => {
  const adminEmail = `ops-${randomUUID()}@example.com`
  ids.set("admin", await one(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) values ($1, $2, 'Ops Admin', 'active', now()) returning id",
    [adminEmail, nextPhone()],
  ))
  const approvedEmail = `client-${randomUUID()}@example.com`
  const approvedPhone = nextPhone()
  ids.set("approvedApplication", await one(
    "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
      "values ($1, $2, 'Asha Verma', 'approved', now() - interval '3 days', now() - interval '2 days') returning id",
    [approvedEmail, approvedPhone],
  ))
  ids.set("client", await one(
    "insert into users (application_id, email_normalized, phone_e164, full_name, account_state, activated_at, email_verification_state, email_verified_at) " +
      "values ($1, $2, $3, 'Asha Verma', 'active', now(), 'verified', now()) returning id",
    [idOf("approvedApplication"), approvedEmail, approvedPhone],
  ))
  await pool.query("insert into user_credentials (user_id, password_hash, version) values ($1, '$argon2id$v=19$legacy', 3)", [idOf("client")])
  ids.set("adminCreated", await one(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) values ($1, $2, 'Ravi Menon', 'active', now()) returning id",
    [`created-${randomUUID()}@example.com`, nextPhone()],
  ))
  ids.set("suspended", await one(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, suspended_at) " +
      "values ($1, $2, 'Meera Kapoor', 'suspended', now(), now()) returning id",
    [`suspended-${randomUUID()}@example.com`, nextPhone()],
  ))
  await pool.query(
    "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at) values ($1, $2, 'Pending Person', 'submitted', now())",
    [`pending-${randomUUID()}@example.com`, nextPhone()],
  )
  await pool.query(
    "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
      "values ($1, $2, 'Rejected Person', 'rejected', now() - interval '5 days', now() - interval '4 days')",
    [`rejected-${randomUUID()}@example.com`, nextPhone()],
  )
}

const seedTokens = async (): Promise<void> => {
  const insert = async (label: string, userId: string, purpose: "set" | "reset", expiresInMs: number, consumed: boolean) => {
    ids.set(label, await one(
      "insert into password_credential_tokens (user_id, purpose, token_hash, token_key_version, attempt_count, expires_at, consumed_at, created_at) " +
        "values ($1, $2::password_token_purpose, $3, 'tk1', 0, $4, $5, now() - interval '2 hours') returning id",
      [userId, purpose, crypto.hashToken(randomUUID()).hash, new Date(Date.now() + expiresInMs), consumed ? new Date(Date.now() - HOUR_MS) : null],
    ))
  }
  await insert("liveSet", idOf("adminCreated"), "set", HOUR_MS, false)
  await insert("liveReset", idOf("client"), "reset", HOUR_MS, false)
  await insert("expired", idOf("suspended"), "reset", -HOUR_MS, false)
  await insert("consumed", idOf("suspended"), "set", HOUR_MS, true)
}

const seedMail = async (label: string, templateKey: "account_approved" | "application_rejected", outboxState: string, deliveryState: string) => {
  const email = `${label}-${randomUUID()}@example.com`
  const outboxId = await one(
    "insert into outbox_events (topic, event_type, event_version, aggregate_type, aggregate_id, occurred_at, request_id, " +
      "deduplication_key, payload, state, attempt_count, available_at, delivered_at, cancelled_at) " +
      "values ('email', $1, 1, 'application', $2, now() - interval '2 hours', $3, $4, $5::jsonb, $6::outbox_state, $7, now() - interval '2 hours', " +
      "case when $6 = 'delivered' then now() - interval '1 hour' end, case when $6 = 'cancelled' then now() - interval '1 hour' end) returning id",
    [
      `application.${templateKey}`,
      idOf("approvedApplication"),
      randomUUID(),
      `legacy-${label}-${randomUUID()}`,
      JSON.stringify({ template: templateKey }),
      outboxState,
      outboxState === "pending" ? 0 : 1,
    ],
  )
  const envelope = crypto.encryptRecipient(email)
  ids.set(label, await one(
    "insert into email_deliveries (outbox_event_id, application_id, template_key, template_version, recipient_ciphertext, recipient_nonce, " +
      "recipient_hmac, recipient_masked, recipient_encryption_key_version, suppression_hmac_key_version, ses_configuration_set, state, " +
      "attempt_count, last_attempt_at, sent_at, delivered_at, cancelled_at, created_at) " +
      "values ($1, $2, $3, 'v1', $4, $5, $6, 'l***@example.com', $7, $8, 'boe-transactional', $9::email_delivery_state, $10, " +
      "case when $10::int > 0 then now() - interval '1 hour' end, case when $9 in ('sent', 'delivered') then now() - interval '1 hour' end, " +
      "case when $9 = 'delivered' then now() - interval '50 minutes' end, case when $9 = 'cancelled' then now() - interval '1 hour' end, " +
      "now() - interval '2 hours') returning id",
    [
      outboxId,
      idOf("approvedApplication"),
      templateKey,
      envelope.ciphertext,
      envelope.nonce,
      crypto.hmacRecipient(email).hash,
      envelope.keyVersion,
      crypto.suppressionHmacKeyVersion,
      deliveryState,
      outboxState === "pending" ? 0 : 1,
    ],
  ))
}

const seedReceipts = async (): Promise<void> => {
  const insert = (key: string, expiresAt: string) =>
    pool.query(
      "insert into idempotency_records (actor_scope, http_method, route_template, key, request_hash, response_status, response_body, created_at, completed_at, expires_at) " +
        "values ($1, 'POST', '/v1/admin/clients', $2, $3, 201, $4::jsonb, now() - interval '2 days', now() - interval '2 days', $5)",
      [`admin:${idOf("admin")}`, key, randomBytes(32), JSON.stringify({ userId: idOf("adminCreated") }), expiresAt],
    )
  await insert(`ordinary-${randomUUID()}`, new Date(Date.now() + HOUR_MS).toISOString())
  await insert(`expired-${randomUUID()}`, new Date(Date.now() - HOUR_MS).toISOString())
  await insert(`durable-${randomUUID()}`, DURABLE_EXPIRY)
}

const seedLedger = async (): Promise<void> => {
  const admin = idOf("admin")
  const client = idOf("client")
  const fundId = await one(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`fund-${randomUUID().slice(0, 8)}`, admin],
  )
  const disclosureId = await one(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), admin],
  )
  const versionId = await one(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'Balanced Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4) returning id",
    [fundId, disclosureId, randomBytes(32), admin],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [versionId, fundId])
  const orderId = await one(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'lump_sum', 'accepted', 2500000, now()) returning id",
    [client, fundId, versionId],
  )
  const paymentId = await one(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, 2500000, 'succeeded', now()) returning id",
    [orderId, client],
  )
  const allocationId = await one(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, 2500000, $4, $5) returning id",
    [orderId, client, fundId, admin, `req-${randomUUID()}`],
  )
  await pool.query(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', 2500000, 2500000, current_date - 30, $4, $5, 'investment_accepted', 'admin', $6, $7)",
    [client, fundId, allocationId, orderId, paymentId, admin, `req-${randomUUID()}`],
  )
  const batchId = await one(
    "insert into client_growth_batches (scope, instruction_type, effective_date, reason_code, basis_hash, actor_user_id, request_id, target_count, total_delta_paise) " +
      "values ('individual', 'amount', current_date, 'monthly_growth', 'basis', $1, $2, 1, 125000) returning id",
    [admin, `req-${randomUUID()}`],
  )
  await pool.query(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "growth_batch_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'growth_adjustment', 0, 125000, current_date, $3, 'monthly_growth', 'admin', $4, $5)",
    [client, fundId, batchId, admin, `req-${randomUUID()}`],
  )
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 4, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  crypto = createCryptoContext(parseCryptoKeys(CRYPTO_ENV))
  const migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations.filter((migration) => migration.version <= RELEASED_SCHEMA))

  await seedPeople()
  await seedTokens()
  await seedMail("queuedApproval", "account_approved", "pending", "queued")
  await seedMail("deliveredApproval", "account_approved", "delivered", "delivered")
  await seedMail("cancelledRejection", "application_rejected", "cancelled", "cancelled")
  await seedReceipts()
  await seedLedger()

  before = await snapshot()
  await runMigrations(pool, migrations)
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("upgrading a populated v0.14.7 database to v0.15.0 in one run", () => {
  test("applies every migration after 051", async () => {
    const applied = (await pool.query<{ version: string }>("select version from schema_migrations where version > $1 order by version", [RELEASED_SCHEMA])).rows
    expect(applied.map((row) => row.version.slice(0, 3))).toEqual(["052", "053", "054", "055", "056", "057", "058", "059", "060"])
  })

  test("keeps every existing row in every existing table exactly as it was, and adds none", async () => {
    const after = await snapshot([...before.keys()])

    for (const [table, earlier] of before) {
      const later = after.get(table)
      expect(later, table).toBeDefined()
      expect(restrictTo(later?.rows ?? [], earlier.columns), table).toEqual(earlier.rows)
    }
    expect(before.get("users")?.rows.length).toBe(4)
    expect(before.get("client_value_entries")?.rows.length).toBe(2)
  })

  test("re-queues no historical mail and starts every fence at zero", async () => {
    const outbox = await pool.query<{ state: string; lease_generation: number }>("select state, lease_generation from outbox_events order by state::text")
    const attempts = await pool.query("select 1 from email_send_attempts")
    const payloads = await pool.query("select 1 from email_delivery_payloads")

    expect(outbox.rows).toEqual([
      { state: "cancelled", lease_generation: 0 },
      { state: "delivered", lease_generation: 0 },
      { state: "pending", lease_generation: 0 },
    ])
    expect(attempts.rowCount).toBe(0)
    expect(payloads.rowCount).toBe(0)
  })

  test("binds only the live password links to the account as it stood", async () => {
    const binding = async (label: string) =>
      (await pool.query<Row>("select bound_email_revision, bound_credential_version from password_credential_tokens where id = $1", [idOf(label)])).rows[0]

    expect(await binding("liveSet")).toEqual({ bound_email_revision: "1", bound_credential_version: "0" })
    expect(await binding("liveReset")).toEqual({ bound_email_revision: "1", bound_credential_version: "3" })
    expect(await binding("expired")).toEqual({ bound_email_revision: null, bound_credential_version: null })
    expect(await binding("consumed")).toEqual({ bound_email_revision: null, bound_credential_version: null })
    expect((await pool.query("select distinct email_revision from users")).rows).toEqual([{ email_revision: "1" }])
  })

  test("starts the new features empty apart from the five preloaded templates", async () => {
    const count = async (table: string) => Number((await pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n)

    expect(await count("email_templates")).toBe(5)
    expect(await count("email_template_revisions")).toBe(5)
    expect(await count("email_change_requests")).toBe(0)
    expect(await count("admin_email_messages")).toBe(0)
    expect(await count("app_update_announcements")).toBe(0)
  })

  test("accepts every template key the new release queues and still refuses an unknown one", async () => {
    const accepts = async (templateKey: string): Promise<boolean> => {
      const client = await pool.connect()
      try {
        await client.query("begin")
        await client.query("update email_deliveries set template_key = $2 where id = $1", [idOf("queuedApproval"), templateKey])
        return true
      } catch {
        return false
      } finally {
        await client.query("rollback")
        client.release()
      }
    }

    for (const key of ["password_set_link", "password_reset_link", "password_app_download", "contact_phone_changed", "email_change_code", "contact_email_changed", "admin_message", "app_update_notice"]) {
      expect(await accepts(key), key).toBe(true)
    }
    expect(await accepts("statement_ready")).toBe(false)
  })
})
