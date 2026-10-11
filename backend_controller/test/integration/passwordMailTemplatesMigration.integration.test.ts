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

const TEMPLATE_MIGRATION = "055_password_mail_templates"
const TEMPLATE_MIGRATION_FILE = "055_password_mail_templates.sql"
const HOUR_MS = 3_600_000
const EXISTING_KEYS = ["account_approved", "application_rejected"] as const
const NEW_KEYS = ["password_set_link", "password_reset_link", "password_app_download"] as const

type Row = Record<string, unknown>
type DeliveryState = "queued" | "sending" | "sent" | "delivered" | "retryable_failed" | "permanent_failed" | "cancelled"
type OutboxState = "pending" | "sending" | "delivered" | "retryable_failed" | "dead_lettered" | "cancelled"

const OUTBOX_FOR: Readonly<Record<DeliveryState, OutboxState>> = {
  queued: "pending",
  sending: "sending",
  sent: "delivered",
  delivered: "delivered",
  retryable_failed: "retryable_failed",
  permanent_failed: "dead_lettered",
  cancelled: "cancelled",
}

let container: StartedPostgreSqlContainer
let pool: Pool
let crypto: CryptoContext
let phoneCounter = 0
let seededCount = 0

const key = (): string => randomBytes(32).toString("base64")

const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415554${String(phoneCounter).padStart(4, "0")}`
}

const insertOutbox = async (state: OutboxState): Promise<string> => {
  const inFlight = state === "sending"
  const earlier = new Date(Date.now() - 2 * HOUR_MS)
  const id = (
    await pool.query<{ id: string }>(
      "insert into outbox_events (topic, event_type, event_version, aggregate_type, aggregate_id, occurred_at, " +
        "request_id, deduplication_key, payload, state, attempt_count, lease_generation, available_at, locked_at, " +
        "locked_by, lease_expires_at, delivered_at, cancelled_at, last_error_code) " +
        "values ('email', 'user.test', 1, 'user', $1, $2, $3, $4, '{}'::jsonb, $5::outbox_state, $6, $7, $2, $8, $9, $10, $11, $12, $13) " +
        "returning id",
      [
        randomUUID(),
        earlier,
        randomUUID(),
        `dedup-${randomUUID()}`,
        state,
        state === "pending" ? 0 : 1,
        state === "pending" ? 0 : 1,
        inFlight ? earlier : null,
        inFlight ? "legacy-worker" : null,
        inFlight ? new Date(earlier.getTime() + 60_000) : null,
        state === "delivered" ? earlier : null,
        state === "cancelled" ? earlier : null,
        state === "dead_lettered" ? "SMTP_PERMANENT_REJECT" : null,
      ],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("outbox row not created")
  return id
}

const insertDelivery = async (
  templateKey: string,
  state: DeliveryState,
  subject: { readonly applicationId: string | null; readonly userId: string | null },
): Promise<string> => {
  const outboxId = await insertOutbox(OUTBOX_FOR[state])
  const email = `delivery-${randomUUID()}@example.com`
  const envelope = crypto.encryptRecipient(email)
  const id = (
    await pool.query<{ id: string }>(
      "insert into email_deliveries (outbox_event_id, application_id, user_id, template_key, template_version, " +
        "recipient_ciphertext, recipient_nonce, recipient_hmac, recipient_masked, recipient_encryption_key_version, " +
        "suppression_hmac_key_version, ses_configuration_set, state, attempt_count, last_attempt_at, sent_at, " +
        "delivered_at, cancelled_at) " +
        "values ($1, $2, $3, $4, 'v1', $5, $6, $7, 'a***@example.com', $8, $9, 'boe-transactional', " +
        "$10::email_delivery_state, $11, " +
        "case when $11::int > 0 then now() end, " +
        "case when $10::email_delivery_state in ('sent', 'delivered') then now() end, " +
        "case when $10::email_delivery_state = 'delivered' then now() end, " +
        "case when $10::email_delivery_state = 'cancelled' then now() end) returning id",
      [
        outboxId,
        subject.applicationId,
        subject.userId,
        templateKey,
        envelope.ciphertext,
        envelope.nonce,
        crypto.hmacRecipient(email).hash,
        envelope.keyVersion,
        crypto.suppressionHmacKeyVersion,
        state,
        state === "queued" ? 0 : 1,
      ],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error(`delivery not created for ${templateKey}`)
  return id
}

const insertApplication = async (): Promise<string> => {
  const id = (
    await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
        "values ($1, $2, 'Ada Lovelace', 'approved', now(), now()) returning id",
      [`application-${randomUUID()}@example.com`, nextPhone()],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("application not created")
  return id
}

const insertUser = async (): Promise<string> => {
  const id = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, 'Ada Lovelace', 'active', now()) returning id",
      [`user-${randomUUID()}@example.com`, nextPhone()],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("user not created")
  return id
}

const dataSnapshot = async (): Promise<Record<string, Row[]>> => {
  const tables = (
    await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' " +
        "and table_type = 'BASE TABLE' and table_name <> 'schema_migrations' order by table_name",
    )
  ).rows
  const snapshot: Record<string, Row[]> = {}
  for (const { table_name: table } of tables) {
    const rows = (await pool.query<{ row: Row }>(`select to_jsonb(t) as row from "${table}" t`)).rows.map(({ row }) => row)
    snapshot[table] = rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  }
  return snapshot
}

const schemaSnapshot = async (): Promise<Record<string, string[]>> => ({
  columns: (
    await pool.query<Row>(
      "select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns " +
        "where table_schema = 'public' order by table_name, ordinal_position",
    )
  ).rows.map((row) => `${String(row.table_name)}.${String(row.column_name)} ${String(row.data_type)} ${String(row.is_nullable)} ${String(row.column_default)}`),
  constraints: (
    await pool.query<Row>(
      "select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint " +
        "where connamespace = 'public'::regnamespace order by 1, 2",
    )
  ).rows.map((row) => `${String(row.table_name)}.${String(row.conname)} ${String(row.definition)}`),
  indexes: (
    await pool.query<Row>("select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2")
  ).rows.map((row) => `${String(row.tablename)}.${String(row.indexname)} ${String(row.indexdef)}`),
  triggers: (
    await pool.query<Row>(
      "select event_object_table, trigger_name from information_schema.triggers where trigger_schema = 'public' order by 1, 2",
    )
  ).rows.map((row) => `${String(row.event_object_table)}.${String(row.trigger_name)}`),
})

const refusal = async (attempt: () => Promise<unknown>): Promise<string> => {
  try {
    await attempt()
  } catch (error) {
    return (error as { constraint?: string }).constraint ?? String(error)
  }
  return "accepted"
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({
    connectionString: container.getConnectionUri(),
    poolMax: 5,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
  })
  crypto = createCryptoContext(
    parseCryptoKeys({
      CRYPTO_TOKEN_HASH_KEY: key(),
      CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
      CRYPTO_CONSENT_IP_HMAC_KEY: key(),
      CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
      CRYPTO_RECIPIENT_HMAC_KEY: key(),
      CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
      CRYPTO_RECIPIENT_ENC_KEY: key(),
      CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
    }),
  )
  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
  const migrations = await loadMigrationFiles(directory)
  await runMigrations(pool, migrations.filter((migration) => migration.version < TEMPLATE_MIGRATION))

  for (const templateKey of EXISTING_KEYS) {
    for (const state of Object.keys(OUTBOX_FOR) as DeliveryState[]) {
      await insertDelivery(templateKey, state, { applicationId: await insertApplication(), userId: null })
      seededCount += 1
    }
  }
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("password mail template migration populated upgrade", () => {
  test("the data it must keep is real: every existing delivery uses an old key, in every state", async () => {
    const stored = await pool.query<{ template_key: string; state: string; count: number }>(
      "select template_key, state::text, count(*)::int as count from email_deliveries group by 1, 2 order by 1, 2",
    )

    expect(seededCount).toBe(14)
    expect(stored.rows).toHaveLength(14)
    expect(new Set(stored.rows.map((row) => row.template_key))).toEqual(new Set(EXISTING_KEYS))
    expect(new Set(stored.rows.map((row) => row.state)).size).toBe(7)
  })

  test("before the migration a new key is refused by the template check", async () => {
    const userId = await insertUser()

    for (const templateKey of NEW_KEYS) {
      expect(await refusal(() => insertDelivery(templateKey, "queued", { applicationId: null, userId }))).toBe(
        "email_deliveries_template_check",
      )
    }
  })

  test("changes only the template check, and leaves every row and every other table as recorded", async () => {
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const migrations = await loadMigrationFiles(directory)
    const dataBefore = await dataSnapshot()
    const schemaBefore = await schemaSnapshot()

    const applied = await runMigrations(
      pool,
      migrations.filter((migration) => migration.version === TEMPLATE_MIGRATION),
    )

    expect(applied).toEqual([TEMPLATE_MIGRATION_FILE])
    expect(Object.values(dataBefore).flat().length).toBeGreaterThan(0)
    expect(await dataSnapshot()).toEqual(dataBefore)
    const schemaAfter = await schemaSnapshot()
    for (const kind of ["columns", "indexes", "triggers"] as const) {
      expect(schemaAfter[kind]).toEqual(schemaBefore[kind])
    }
    const mentioningTemplateKey = await pool.query<{ conname: string }>(
      "select conname from pg_constraint where conrelid = 'email_deliveries'::regclass " +
        "and pg_get_constraintdef(oid) like '%template_key%' order by conname",
    )
    expect(mentioningTemplateKey.rows.map((row) => row.conname)).toEqual([
      "email_deliveries_template_check",
      "email_deliveries_template_key_check",
    ])
    const before = schemaBefore.constraints ?? []
    const after = schemaAfter.constraints ?? []
    expect(before.filter((entry) => !after.includes(entry)).map((entry) => entry.split(" ")[0])).toEqual([
      "email_deliveries.email_deliveries_template_check",
    ])
    expect(after.filter((entry) => !before.includes(entry)).map((entry) => entry.split(" ")[0])).toEqual([
      "email_deliveries.email_deliveries_template_check",
    ])
  })

  test("now takes exactly the three new keys for a mail recorded against a user alone", async () => {
    const userId = await insertUser()

    for (const templateKey of NEW_KEYS) {
      await insertDelivery(templateKey, "queued", { applicationId: null, userId })
    }

    const stored = await pool.query<{ template_key: string; application_id: string | null; user_id: string | null }>(
      "select template_key, application_id, user_id from email_deliveries where user_id = $1 order by template_key",
      [userId],
    )
    expect(stored.rows).toEqual(
      [...NEW_KEYS].sort().map((templateKey) => ({ template_key: templateKey, application_id: null, user_id: userId })),
    )
  })

  test("still refuses an unknown key, a blank key and a delivery with no subject", async () => {
    const userId = await insertUser()

    expect(await refusal(() => insertDelivery("password_other", "queued", { applicationId: null, userId }))).toBe(
      "email_deliveries_template_check",
    )
    expect(await refusal(() => insertDelivery("verify_email", "queued", { applicationId: null, userId }))).toBe(
      "email_deliveries_template_check",
    )
    expect(await refusal(() => insertDelivery("  ", "queued", { applicationId: null, userId }))).not.toBe("accepted")
    expect(await refusal(() => insertDelivery("password_set_link", "queued", { applicationId: null, userId: null }))).toBe(
      "email_deliveries_subject_present",
    )
  })

  test("keeps taking the old keys as before", async () => {
    const applicationId = await insertApplication()

    for (const templateKey of EXISTING_KEYS) {
      await insertDelivery(templateKey, "queued", { applicationId, userId: null })
    }

    const stored = await pool.query<{ count: number }>(
      "select count(*)::int as count from email_deliveries where application_id = $1",
      [applicationId],
    )
    expect(stored.rows[0]?.count).toBe(2)
  })
})
