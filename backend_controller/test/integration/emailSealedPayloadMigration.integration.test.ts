import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool, PoolClient } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import type { CryptoContext } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import type { UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { dispatchDueDeliveries } from "../../src/domain/email/dispatchDueDeliveries.js"
import { CLAIMED_EMAIL_TOPICS, SEALED_EMAIL_TOPIC } from "../../src/domain/email/emailTopics.js"
import { enqueueEmail } from "../../src/domain/email/enqueueEmail.js"
import type { SesEmailSender, SesSendRequest } from "../../src/email/ports.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createEmailSuppressionRepository } from "../../src/repositories/emailSuppressionRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const PAYLOAD_MIGRATION = "053_email_delivery_payloads"
const PAYLOAD_MIGRATION_FILE = "053_email_delivery_payloads.sql"
const HOUR_MS = 3_600_000
const SECRET = "secret-token-9f2c"
const SECRET_URL = `https://downloads.test/${SECRET}/boe.apk`

const PREVIOUS_RELEASE = {
  claimSelect:
    'select "id" from "outbox_events" where "topic" = $1 and "state" in ($2, $3) and "available_at" <= $4 order by "available_at", "created_at", "id" limit $5 for update skip locked',
  claimUpdate:
    'update "outbox_events" set "state" = $1, "locked_at" = $2, "locked_by" = $3, "lease_expires_at" = $4, "updated_at" = $5 where "id" in ($6) returning *',
  markSending:
    'update "outbox_events" set "state" = $1, "attempt_count" = attempt_count + 1, "updated_at" = $2 where "id" = $3 and "state" = $4',
  settleDelivered:
    'update "outbox_events" set "state" = $1, "delivered_at" = $2, "updated_at" = $3, "locked_at" = $4, "locked_by" = $5, "lease_expires_at" = $6 where "id" = $7 and "state" = $8',
  recoverExpiredLeases:
    'update "outbox_events" set "state" = $1, "available_at" = $2, "updated_at" = $3, "locked_at" = $4, "locked_by" = $5, "lease_expires_at" = $6 where "state" in ($7, $8) and "lease_expires_at" < $9',
} as const

type Row = Record<string, unknown>

interface Seed {
  readonly label: string
  readonly outboxState:
    | "pending"
    | "processing"
    | "sending"
    | "retryable_failed"
    | "delivered"
    | "cancelled"
    | "dead_lettered"
  readonly deliveryState:
    | "queued"
    | "sending"
    | "sent"
    | "delivered"
    | "retryable_failed"
    | "permanent_failed"
    | "cancelled"
  readonly attemptCount?: number
  readonly leaseGeneration?: number
}

interface Seeded {
  readonly outboxId: string
  readonly deliveryId: string
  readonly email: string
}

let container: StartedPostgreSqlContainer
let pool: Pool
let unitOfWork: UnitOfWork
let crypto: CryptoContext
let phoneCounter = 0

const outboxRepository = createOutboxRepository()
const emailDeliveryRepository = createEmailDeliveryRepository()
const emailSuppressionRepository = createEmailSuppressionRepository()
const key = (): string => randomBytes(32).toString("base64")

const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415556${String(phoneCounter).padStart(4, "0")}`
}

const seedMessage = async (seed: Seed): Promise<Seeded> => {
  const inFlight = seed.outboxState === "processing" || seed.outboxState === "sending"
  const twoHoursAgo = new Date(Date.now() - 2 * HOUR_MS)
  const email = `${seed.label}-${randomUUID()}@example.com`

  const applicationId = (
    await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
        "values ($1, $2, 'Ada Lovelace', 'approved', now(), now()) returning id",
      [email, nextPhone()],
    )
  ).rows[0]?.id

  const outboxId = (
    await pool.query<{ id: string }>(
      "insert into outbox_events (topic, event_type, event_version, aggregate_type, aggregate_id, occurred_at, " +
        "request_id, deduplication_key, payload, state, attempt_count, lease_generation, available_at, locked_at, " +
        "locked_by, lease_expires_at, delivered_at, cancelled_at, last_error_code) " +
        "values ('email', 'user.account_approved', 1, 'user', $1, $2, $3, $4, $5::jsonb, $6::outbox_state, $7, $8, " +
        "$9, $10, $11, $12, $13, $14, $15) returning id",
      [
        randomUUID(),
        twoHoursAgo,
        randomUUID(),
        `dedup-${seed.label}-${randomUUID()}`,
        JSON.stringify({ template: "account_approved", downloadUrl: "https://downloads.test/boe.apk" }),
        seed.outboxState,
        seed.attemptCount ?? 0,
        seed.leaseGeneration ?? 0,
        twoHoursAgo,
        inFlight ? twoHoursAgo : null,
        inFlight ? "legacy-worker" : null,
        inFlight ? new Date(twoHoursAgo.getTime() + 60_000) : null,
        seed.outboxState === "delivered" ? twoHoursAgo : null,
        seed.outboxState === "cancelled" ? twoHoursAgo : null,
        seed.outboxState === "dead_lettered" ? "SMTP_PERMANENT_REJECT" : null,
      ],
    )
  ).rows[0]?.id

  const envelope = crypto.encryptRecipient(email)
  const deliveryId = (
    await pool.query<{ id: string }>(
      "insert into email_deliveries (outbox_event_id, application_id, template_key, template_version, " +
        "recipient_ciphertext, recipient_nonce, recipient_hmac, recipient_masked, recipient_encryption_key_version, " +
        "suppression_hmac_key_version, ses_configuration_set, state, attempt_count, last_attempt_at, sent_at, " +
        "delivered_at, cancelled_at) " +
        "values ($1, $2, 'account_approved', 'v1', $3, $4, $5, 'a***@example.com', $6, $7, 'boe-transactional', " +
        "$8::email_delivery_state, $9, " +
        "case when $9::int > 0 then now() end, " +
        "case when $8::email_delivery_state in ('sent', 'delivered') then now() end, " +
        "case when $8::email_delivery_state = 'delivered' then now() end, " +
        "case when $8::email_delivery_state = 'cancelled' then now() end) " +
        "returning id",
      [
        outboxId,
        applicationId,
        envelope.ciphertext,
        envelope.nonce,
        crypto.hmacRecipient(email).hash,
        envelope.keyVersion,
        crypto.suppressionHmacKeyVersion,
        seed.deliveryState,
        seed.attemptCount ?? 0,
      ],
    )
  ).rows[0]?.id

  if (outboxId === undefined || deliveryId === undefined) throw new Error(`seed rows not created for ${seed.label}`)
  return { outboxId, deliveryId, email }
}

const queueSealed = async (label: string): Promise<Seeded> => {
  const email = `${label}-${randomUUID()}@example.com`
  const phone = nextPhone()
  const applicationId = (
    await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
        "values ($1, $2, 'Ada Lovelace', 'approved', now(), now()) returning id",
      [email, phone],
    )
  ).rows[0]?.id
  const userId = (
    await pool.query<{ id: string }>(
      "insert into users (application_id, email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, $3, 'Ada Lovelace', 'active', now()) returning id",
      [applicationId, email, phone],
    )
  ).rows[0]?.id
  if (applicationId === undefined || userId === undefined) throw new Error(`sealed seed not created for ${label}`)

  const queued = await unitOfWork.execute((tx) =>
    enqueueEmail(
      tx,
      { outboxRepository, emailDeliveryRepository, crypto },
      {
        recipient: email,
        template: { templateKey: "account_approved", userId, applicationId },
        templateVersion: "v1",
        sesConfigurationSet: "boe-transactional",
        eventType: "user.account_approved",
        eventVersion: 1,
        aggregateType: "user",
        aggregateId: userId,
        requestId: randomUUID(),
        deduplicationKey: `account_approved:${userId}`,
        payload: { template: "account_approved" },
        sealedPayload: { downloadUrl: SECRET_URL },
      },
    ),
  )
  return { outboxId: queued.outbox.id, deliveryId: queued.delivery.id, email }
}

const outboxRow = async (outboxId: string): Promise<Row> =>
  (await pool.query<Row>("select * from outbox_events where id = $1", [outboxId])).rows[0] ?? {}

const deliveryRow = async (deliveryId: string): Promise<Row> =>
  (await pool.query<Row>("select * from email_deliveries where id = $1", [deliveryId])).rows[0] ?? {}

const payloadRow = async (deliveryId: string): Promise<Row> =>
  (await pool.query<Row>("select * from email_delivery_payloads where email_delivery_id = $1", [deliveryId])).rows[0] ?? {}

const DATA_TABLES = [
  ["outbox_events", "id"],
  ["email_deliveries", "id"],
  ["email_send_attempts", "outbox_event_id, generation"],
  ["idempotency_records", "id"],
] as const

const dataSnapshot = async (): Promise<Record<string, Row[]>> => {
  const snapshot: Record<string, Row[]> = {}
  for (const [table, order] of DATA_TABLES) {
    snapshot[table] = (await pool.query<Row>(`select * from ${table} order by ${order}`)).rows
  }
  return snapshot
}

const schemaSnapshot = async (): Promise<Record<string, Row[]>> => ({
  columns: (
    await pool.query<Row>(
      "select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns " +
        "where table_schema = 'public' and table_name <> 'email_delivery_payloads' order by table_name, ordinal_position",
    )
  ).rows,
  constraints: (
    await pool.query<Row>(
      "select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint " +
        "where connamespace = 'public'::regnamespace and conrelid::regclass::text <> 'email_delivery_payloads' order by 1, 2",
    )
  ).rows,
  indexes: (
    await pool.query<Row>(
      "select tablename, indexname, indexdef from pg_indexes " +
        "where schemaname = 'public' and tablename <> 'email_delivery_payloads' order by 1, 2",
    )
  ).rows,
  triggers: (
    await pool.query<Row>(
      "select event_object_table, trigger_name from information_schema.triggers where trigger_schema = 'public' order by 1, 2",
    )
  ).rows,
})

const inPreviousRelease = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query("begin")
    try {
      return await work(client)
    } finally {
      await client.query("rollback")
    }
  } finally {
    client.release()
  }
}

const previousReleaseClaimAll = async (client: PoolClient, now: Date): Promise<string[]> => {
  const claimed: string[] = []
  for (;;) {
    const due = await client.query<{ id: string }>(PREVIOUS_RELEASE.claimSelect, [
      "email",
      "pending",
      "retryable_failed",
      now,
      1,
    ])
    const id = due.rows[0]?.id
    if (id === undefined) return claimed
    await client.query(PREVIOUS_RELEASE.claimUpdate, [
      "processing",
      now,
      "previous-release",
      new Date(now.getTime() + 60_000),
      now,
      id,
    ])
    claimed.push(id)
  }
}

const capturingSender = (): SesEmailSender & { readonly requests: SesSendRequest[] } => {
  const requests: SesSendRequest[] = []
  return {
    requests,
    send: (request) => {
      requests.push(request)
      return Promise.resolve({ outcome: "accepted", sesMessageId: `payload-migration-${randomUUID()}`, sesRequestId: null })
    },
  }
}

const dispatchBothTopics = (sender: SesEmailSender, now: () => Date) =>
  dispatchDueDeliveries({
    unitOfWork,
    outboxRepository,
    emailDeliveryRepository,
    emailSuppressionRepository,
    sender,
    crypto,
    clock: now,
    config: {
      topics: CLAIMED_EMAIL_TOPICS,
      workerId: "worker-new",
      leaseMs: 30_000,
      claimLimit: 20,
      messageBudgetMs: 25_000,
      passBudgetMs: 35_000,
    },
  })

const LEGACY_SEEDS: readonly Seed[] = [
  { label: "legacy-queued", outboxState: "pending", deliveryState: "queued" },
  { label: "legacy-processing", outboxState: "processing", deliveryState: "queued" },
  { label: "legacy-sending", outboxState: "sending", deliveryState: "sending", attemptCount: 1 },
  { label: "legacy-retry", outboxState: "retryable_failed", deliveryState: "retryable_failed", attemptCount: 1, leaseGeneration: 1 },
  { label: "legacy-delivered", outboxState: "delivered", deliveryState: "delivered", attemptCount: 1 },
  { label: "legacy-cancelled", outboxState: "cancelled", deliveryState: "cancelled" },
  { label: "legacy-dead", outboxState: "dead_lettered", deliveryState: "permanent_failed", attemptCount: 8 },
]

const seeded = new Map<string, Seeded>()
let dataBefore: Record<string, Row[]>
let schemaBefore: Record<string, Row[]>

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
  unitOfWork = createUnitOfWork(createDatabase(pool))
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
  await runMigrations(pool, migrations.filter((migration) => migration.version < PAYLOAD_MIGRATION))

  for (const seed of LEGACY_SEEDS) seeded.set(seed.label, await seedMessage(seed))
  const retry = seeded.get("legacy-retry")
  await pool.query(
    "insert into email_send_attempts (outbox_event_id, generation, worker_id, started_at, finished_at, outcome, error_code) " +
      "values ($1, 1, 'worker-old', now() - interval '3 hours', now() - interval '3 hours' + interval '1 second', " +
      "'retryable', 'SMTP_TRANSPORT_ERROR')",
    [retry?.outboxId],
  )
  await pool.query(
    "insert into idempotency_records (actor_scope, http_method, route_template, key, request_hash, response_status, " +
      "response_body, expires_at) values ('admin:legacy', 'POST', '/v1/admin/legacy', 'legacy-key', $1, 200, '{}'::jsonb, " +
      "now() + interval '1 day')",
    [randomBytes(32)],
  )
  dataBefore = await dataSnapshot()
  schemaBefore = await schemaSnapshot()
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("email delivery payload populated upgrade", () => {
  test("adds only the payload table and leaves every queued, in-flight, terminal and idempotency row and every existing table definition as recorded", async () => {
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const migrations = await loadMigrationFiles(directory)

    const applied = await runMigrations(pool, migrations.filter((migration) => migration.version >= PAYLOAD_MIGRATION))

    expect(applied).toContain(PAYLOAD_MIGRATION_FILE)
    expect(dataBefore.outbox_events).toHaveLength(LEGACY_SEEDS.length)
    expect(dataBefore.email_send_attempts).toHaveLength(1)
    expect(dataBefore.idempotency_records).toHaveLength(1)
    expect(await dataSnapshot()).toEqual(dataBefore)
    expect(await schemaSnapshot()).toEqual(schemaBefore)
    expect((await pool.query<{ c: number }>("select count(*)::int as c from email_delivery_payloads")).rows[0]?.c).toBe(0)
  })

  test("the previous release's claim statement claims legacy mail and handles it, and never claims a sealed row", async () => {
    const sealed = await queueSealed("sealed-claim")
    const legacy = await seedMessage({ label: "legacy-claim", outboxState: "pending", deliveryState: "queued" })
    const now = new Date(Date.now() + 60_000)

    const outcome = await inPreviousRelease(async (client) => {
      const claimed = await previousReleaseClaimAll(client, now)
      await client.query(PREVIOUS_RELEASE.markSending, ["sending", now, legacy.outboxId, "processing"])
      await client.query(PREVIOUS_RELEASE.settleDelivered, ["delivered", now, now, null, null, null, legacy.outboxId, "sending"])
      const rows = await client.query<Row>(
        "select id, topic, state, locked_by, lease_generation from outbox_events where id = any($1)",
        [[legacy.outboxId, sealed.outboxId]],
      )
      return { claimed, rows: rows.rows }
    })

    expect((await outboxRow(sealed.outboxId)).topic).toBe(SEALED_EMAIL_TOPIC)
    expect(outcome.claimed).toContain(legacy.outboxId)
    expect(outcome.claimed).not.toContain(sealed.outboxId)
    expect(outcome.rows.find((row) => row.id === legacy.outboxId)).toMatchObject({ state: "delivered", locked_by: null })
    expect(outcome.rows.find((row) => row.id === sealed.outboxId)).toMatchObject({
      state: "pending",
      locked_by: null,
      lease_generation: 0,
    })
    expect(await outboxRow(legacy.outboxId)).toMatchObject({ state: "pending" })
  })

  test("the new worker sends legacy and sealed mail from the upgraded schema and scrubs the sealed payload", async () => {
    const sealed = await queueSealed("sealed-send")
    const sender = capturingSender()

    const summary = await dispatchBothTopics(sender, () => new Date(Date.now() + 60_000))

    const sealedRequest = sender.requests.find((request) => request.toAddress === sealed.email)
    expect(summary.sent).toBe(sender.requests.length)
    expect(summary).toMatchObject({ superseded: 0, deadLettered: 0 })
    expect(sealedRequest?.templateData).toEqual({ template: "account_approved", downloadUrl: SECRET_URL })
    expect(sender.requests.some((request) => request.toAddress === seeded.get("legacy-queued")?.email)).toBe(true)
    expect(await outboxRow(sealed.outboxId)).toMatchObject({ state: "delivered", topic: SEALED_EMAIL_TOPIC })
    expect(await deliveryRow(sealed.deliveryId)).toMatchObject({ state: "sent" })
    expect(await payloadRow(sealed.deliveryId)).toMatchObject({ ciphertext: null, nonce: null, scrubbed_at: expect.any(Date) as Date })
    expect(await outboxRow(seeded.get("legacy-sending")?.outboxId ?? "")).toMatchObject({ state: "sending" })
  })

  test("after a rollback the previous release's lease recovery only reopens sealed claims, and the new release then sends the unsent one and keeps the in-doubt one frozen", async () => {
    const unsent = await queueSealed("sealed-unsent")
    const inDoubt = await queueSealed("sealed-in-doubt")
    const legacyRetry = await seedMessage({
      label: "legacy-after-rollback",
      outboxState: "retryable_failed",
      deliveryState: "retryable_failed",
      attemptCount: 1,
    })
    const claimedAt = new Date()
    const recoveredAt = new Date(claimedAt.getTime() + HOUR_MS)
    await unitOfWork.execute(async (tx) => {
      const claimed = await outboxRepository.claimDue(tx, {
        topics: [SEALED_EMAIL_TOPIC],
        workerId: "worker-crashed",
        leaseMs: 30_000,
        limit: 10,
        now: claimedAt,
      })
      expect(claimed.map((event) => event.id).sort()).toEqual([unsent.outboxId, inDoubt.outboxId].sort())
      expect(await outboxRepository.markSending(tx, { outboxEventId: inDoubt.outboxId, generation: 1, workerId: "worker-crashed", now: claimedAt })).toBe(true)
      await emailDeliveryRepository.transitionSending(tx, { deliveryId: inDoubt.deliveryId, now: claimedAt })
    })
    const sidecarBefore = [await payloadRow(unsent.deliveryId), await payloadRow(inDoubt.deliveryId)]

    await pool.query(PREVIOUS_RELEASE.recoverExpiredLeases, [
      "retryable_failed",
      recoveredAt,
      recoveredAt,
      null,
      null,
      null,
      "processing",
      "sending",
      recoveredAt,
    ])
    const previousClaim = await inPreviousRelease((client) =>
      previousReleaseClaimAll(client, new Date(recoveredAt.getTime() + HOUR_MS)),
    )

    expect(await outboxRow(unsent.outboxId)).toMatchObject({ state: "retryable_failed", locked_by: null, topic: SEALED_EMAIL_TOPIC })
    expect(await outboxRow(inDoubt.outboxId)).toMatchObject({ state: "retryable_failed", locked_by: null, topic: SEALED_EMAIL_TOPIC })
    expect(await deliveryRow(unsent.deliveryId)).toMatchObject({ state: "queued" })
    expect(await deliveryRow(inDoubt.deliveryId)).toMatchObject({ state: "sending" })
    expect([await payloadRow(unsent.deliveryId), await payloadRow(inDoubt.deliveryId)]).toEqual(sidecarBefore)
    expect(previousClaim).toContain(legacyRetry.outboxId)
    expect(previousClaim).not.toContain(unsent.outboxId)
    expect(previousClaim).not.toContain(inDoubt.outboxId)

    const sender = capturingSender()
    await dispatchBothTopics(sender, () => new Date(recoveredAt.getTime() + 2 * HOUR_MS))

    expect(sender.requests.find((request) => request.toAddress === unsent.email)?.templateData).toEqual({
      template: "account_approved",
      downloadUrl: SECRET_URL,
    })
    expect(sender.requests.some((request) => request.toAddress === inDoubt.email)).toBe(false)
    expect(await deliveryRow(unsent.deliveryId)).toMatchObject({ state: "sent" })
    expect(await payloadRow(unsent.deliveryId)).toMatchObject({ ciphertext: null, scrubbed_at: expect.any(Date) as Date })
    expect(await deliveryRow(inDoubt.deliveryId)).toMatchObject({ state: "sending" })
    expect(await outboxRow(inDoubt.outboxId)).toMatchObject({ state: "retryable_failed" })
    expect((await payloadRow(inDoubt.deliveryId)).ciphertext).toEqual(sidecarBefore[1]?.ciphertext)
  })
})
