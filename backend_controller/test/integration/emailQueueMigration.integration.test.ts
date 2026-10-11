import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import type { CryptoContext } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import type { UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { dispatchDueDeliveries, type SendGuard } from "../../src/domain/email/dispatchDueDeliveries.js"
import { recoverExpiredDeliveries } from "../../src/domain/email/recoverExpiredDeliveries.js"
import type { SesEmailSender } from "../../src/email/ports.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createEmailSuppressionRepository } from "../../src/repositories/emailSuppressionRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const QUEUE_MIGRATION = "052_email_queue_fencing"
const QUEUE_MIGRATION_FILE = "052_email_queue_fencing.sql"
const HOUR_MS = 3_600_000

type Row = Record<string, unknown>

interface Seed {
  readonly label: string
  readonly topic?: string
  readonly outboxState: "pending" | "processing" | "sending" | "retryable_failed" | "delivered" | "cancelled"
  readonly deliveryState: "queued" | "sending" | "sent" | "delivered" | "retryable_failed" | "cancelled"
  readonly attemptCount?: number
}

interface Seeded {
  readonly outboxId: string
  readonly deliveryId: string
}

let container: StartedPostgreSqlContainer
let pool: Pool
let unitOfWork: UnitOfWork
let crypto: CryptoContext
let phoneCounter = 0

const outboxRepository = createOutboxRepository()
const emailDeliveryRepository = createEmailDeliveryRepository()
const emailSuppressionRepository = createEmailSuppressionRepository()
const seeded = new Map<string, Seeded>()
const key = (): string => randomBytes(32).toString("base64")

const seedMessage = async (seed: Seed): Promise<Seeded> => {
  const inFlight = seed.outboxState === "processing" || seed.outboxState === "sending"
  const twoHoursAgo = new Date(Date.now() - 2 * HOUR_MS)
  const email = `${seed.label}-${randomUUID()}@example.com`
  phoneCounter += 1

  const applicationId = (
    await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
        "values ($1, $2, 'Ada Lovelace', 'approved', now(), now()) returning id",
      [email, `+1415556${String(phoneCounter).padStart(4, "0")}`],
    )
  ).rows[0]?.id

  const outboxId = (
    await pool.query<{ id: string }>(
      "insert into outbox_events (topic, event_type, event_version, aggregate_type, aggregate_id, occurred_at, " +
        "request_id, deduplication_key, payload, state, attempt_count, available_at, locked_at, locked_by, " +
        "lease_expires_at, delivered_at, cancelled_at) " +
        "values ($1, 'user.account_approved', 1, 'user', $2, $3, $4, $5, $6::jsonb, $7::outbox_state, $8, $9, $10, $11, $12, $13, $14) " +
        "returning id",
      [
        seed.topic ?? "email",
        randomUUID(),
        twoHoursAgo,
        randomUUID(),
        `dedup-${seed.label}-${randomUUID()}`,
        JSON.stringify({ template: "account_approved", downloadUrl: "https://downloads.test/boe.apk" }),
        seed.outboxState,
        seed.attemptCount ?? 0,
        twoHoursAgo,
        inFlight ? twoHoursAgo : null,
        inFlight ? "legacy-worker" : null,
        inFlight ? new Date(twoHoursAgo.getTime() + 60_000) : null,
        seed.outboxState === "delivered" ? twoHoursAgo : null,
        seed.outboxState === "cancelled" ? twoHoursAgo : null,
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
  const result = { outboxId, deliveryId }
  seeded.set(seed.label, result)
  return result
}

const idsOf = (label: string): Seeded => {
  const ids = seeded.get(label)
  if (ids === undefined) throw new Error(`nothing seeded as ${label}`)
  return ids
}

const outboxRow = async (outboxId: string): Promise<Row> =>
  (await pool.query<Row>("select * from outbox_events where id = $1", [outboxId])).rows[0] ?? {}

const deliveryRow = async (deliveryId: string): Promise<Row> =>
  (await pool.query<Row>("select * from email_deliveries where id = $1", [deliveryId])).rows[0] ?? {}

const attemptRows = async (outboxId: string): Promise<Row[]> =>
  (await pool.query<Row>("select * from email_send_attempts where outbox_event_id = $1 order by generation", [outboxId])).rows

const withoutFence = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).filter(([column]) => column !== "lease_generation"))

const acceptingSender = (): SesEmailSender & { sent: number } => {
  const sender = {
    sent: 0,
    send: () => {
      sender.sent += 1
      return Promise.resolve({ outcome: "accepted" as const, sesMessageId: `queue-migration-${sender.sent}`, sesRequestId: null })
    },
  }
  return sender
}

const LEGACY_SEEDS: readonly Seed[] = [
  { label: "legacy-pending", outboxState: "pending", deliveryState: "queued" },
  { label: "legacy-processing", outboxState: "processing", deliveryState: "queued" },
  { label: "legacy-sending", outboxState: "sending", deliveryState: "sending", attemptCount: 1 },
  { label: "legacy-recovered-in-doubt", outboxState: "retryable_failed", deliveryState: "sending", attemptCount: 1 },
  { label: "legacy-claimed-in-doubt", outboxState: "processing", deliveryState: "sending", attemptCount: 1 },
  { label: "legacy-delivered", outboxState: "delivered", deliveryState: "delivered", attemptCount: 1 },
  { label: "legacy-cancelled", outboxState: "cancelled", deliveryState: "cancelled" },
]

let before: { readonly outbox: Row[]; readonly deliveries: Row[] }
let afterMigration: Record<string, { readonly outbox: Row; readonly delivery: Row }>

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
  await runMigrations(pool, migrations.filter((migration) => migration.version < QUEUE_MIGRATION))
  for (const seed of LEGACY_SEEDS) await seedMessage(seed)
  before = {
    outbox: (await pool.query<Row>("select * from outbox_events order by deduplication_key")).rows,
    deliveries: (await pool.query<Row>("select * from email_deliveries order by outbox_event_id")).rows,
  }
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("email queue populated upgrade", () => {
  test("keeps every queued, in-flight, delivered and cancelled row as recorded and starts the fence at zero", async () => {
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const migrations = await loadMigrationFiles(directory)

    const applied = await runMigrations(pool, migrations.filter((migration) => migration.version >= QUEUE_MIGRATION))

    const outboxAfter = (await pool.query<Row>("select * from outbox_events order by deduplication_key")).rows
    const deliveriesAfter = (await pool.query<Row>("select * from email_deliveries order by outbox_event_id")).rows
    expect(applied).toContain(QUEUE_MIGRATION_FILE)
    expect(outboxAfter).toHaveLength(LEGACY_SEEDS.length)
    expect(outboxAfter.map(withoutFence)).toEqual(before.outbox)
    expect(outboxAfter.every((row) => row.lease_generation === 0)).toBe(true)
    expect(deliveriesAfter).toEqual(before.deliveries)
    expect((await pool.query<{ c: number }>("select count(*)::int as c from email_send_attempts")).rows[0]?.c).toBe(0)

    afterMigration = {}
    for (const seed of LEGACY_SEEDS) {
      const ids = idsOf(seed.label)
      afterMigration[seed.label] = { outbox: await outboxRow(ids.outboxId), delivery: await deliveryRow(ids.deliveryId) }
    }
  })

  test("the previous release's statements still run against the migrated schema", async () => {
    const enqueued = await pool.query<{ id: string; lease_generation: number }>(
      "insert into outbox_events (topic, event_type, event_version, aggregate_type, aggregate_id, occurred_at, " +
        "request_id, deduplication_key, payload) " +
        "values ('previous-release', 'user.account_approved', 1, 'user', $1, now(), $2, $3, '{}'::jsonb) " +
        "returning id, lease_generation",
      [randomUUID(), randomUUID(), `dedup-previous-${randomUUID()}`],
    )
    const claimed = await pool.query<{ state: string; lease_generation: number }>(
      "update outbox_events set state = 'processing', locked_at = now(), locked_by = 'previous-release', " +
        "lease_expires_at = now() + interval '1 hour', updated_at = now() where id = $1 returning *",
      [enqueued.rows[0]?.id],
    )

    expect(enqueued.rows[0]?.lease_generation).toBe(0)
    expect(claimed.rows[0]).toMatchObject({ state: "processing", lease_generation: 0 })
  })

  test("recovers a legacy unsent claim and sends it, and leaves every legacy in-doubt row exactly as recorded", async () => {
    const sender = acceptingSender()

    const summary = await dispatchDueDeliveries({
      unitOfWork,
      outboxRepository,
      emailDeliveryRepository,
      emailSuppressionRepository,
      sender,
      crypto,
      sendGuards: new Map<string, SendGuard>(),
      clock: () => new Date(),
      config: {
        topics: ["email"],
        workerId: "worker-new",
        leaseMs: 60_000,
        claimLimit: 10,
        messageBudgetMs: 25_000,
        passBudgetMs: 35_000,
      },
    })

    expect(summary).toMatchObject({ recovered: 1, claimed: 2, sent: 2, superseded: 0 })
    expect(sender.sent).toBe(2)
    for (const label of ["legacy-pending", "legacy-processing"]) {
      const ids = idsOf(label)
      expect(await outboxRow(ids.outboxId)).toMatchObject({ state: "delivered", lease_generation: 1, attempt_count: 1 })
      expect(await deliveryRow(ids.deliveryId)).toMatchObject({ state: "sent", attempt_count: 1 })
      expect(await attemptRows(ids.outboxId)).toMatchObject([{ generation: 1, worker_id: "worker-new", outcome: "accepted" }])
    }
    for (const label of [
      "legacy-sending",
      "legacy-recovered-in-doubt",
      "legacy-claimed-in-doubt",
      "legacy-delivered",
      "legacy-cancelled",
    ]) {
      const ids = idsOf(label)
      const frozen = afterMigration[label]
      expect(await outboxRow(ids.outboxId)).toEqual(frozen?.outbox)
      expect(await deliveryRow(ids.deliveryId)).toEqual(frozen?.delivery)
      expect(await attemptRows(ids.outboxId)).toEqual([])
    }
  })
})

describe("email queue fence on PostgreSQL", () => {
  test("a stale generation cannot update a newer claim and its late result is kept as its own attempt", async () => {
    const message = await seedMessage({ label: "fence", topic: "fence", outboxState: "pending", deliveryState: "queued" })
    const t0 = new Date()
    const at = (offsetMs: number): Date => new Date(t0.getTime() + offsetMs)

    const first = await unitOfWork.execute((tx) =>
      outboxRepository.claimDue(tx, { topics: ["fence"], workerId: "worker-a", leaseMs: 60_000, limit: 1, now: t0 }),
    )
    await unitOfWork.execute(async (tx) => {
      expect(await outboxRepository.markSending(tx, { outboxEventId: message.outboxId, generation: 1, workerId: "worker-a", now: at(1_000) })).toBe(true)
      await emailDeliveryRepository.transitionSending(tx, { deliveryId: message.deliveryId, now: at(1_000) })
    })
    const recovered = await recoverExpiredDeliveries({
      unitOfWork,
      outboxRepository,
      emailDeliveryRepository,
      clock: () => at(120_000),
      batchLimit: 10,
    })
    const second = await unitOfWork.execute((tx) =>
      outboxRepository.claimDue(tx, { topics: ["fence"], workerId: "worker-b", leaseMs: 60_000, limit: 1, now: at(400_000) }),
    )
    await unitOfWork.execute(async (tx) => {
      expect(await outboxRepository.markSending(tx, { outboxEventId: message.outboxId, generation: 2, workerId: "worker-b", now: at(401_000) })).toBe(true)
      await emailDeliveryRepository.transitionSending(tx, { deliveryId: message.deliveryId, now: at(401_000) })
    })

    const stale = { outboxEventId: message.outboxId, generation: 1, now: at(402_000) }
    const staleResults = await unitOfWork.execute(async (tx) => ({
      markSending: await outboxRepository.markSending(tx, { ...stale, workerId: "worker-a" }),
      settleDelivered: await outboxRepository.settleDelivered(tx, stale),
      scheduleRetry: await outboxRepository.scheduleRetry(tx, { ...stale, availableAt: at(500_000), errorCode: "STALE" }),
      deadLetter: await outboxRepository.deadLetter(tx, { ...stale, errorCode: "STALE" }),
      cancel: await outboxRepository.cancel(tx, stale),
      release: await outboxRepository.release(tx, stale),
    }))
    await unitOfWork.execute((tx) =>
      outboxRepository.recordAttemptResult(tx, { ...stale, outcome: "accepted", errorCode: null, messageId: "late-accept-1" }),
    )

    expect(first[0]).toMatchObject({ lease_generation: 1, state: "processing" })
    expect(recovered).toBeGreaterThanOrEqual(1)
    expect(second[0]).toMatchObject({ lease_generation: 2, state: "processing", locked_by: "worker-b" })
    expect(staleResults).toEqual({
      markSending: false,
      settleDelivered: false,
      scheduleRetry: false,
      deadLetter: false,
      cancel: false,
      release: false,
    })
    expect(await outboxRow(message.outboxId)).toMatchObject({
      state: "sending",
      lease_generation: 2,
      locked_by: "worker-b",
      attempt_count: 2,
    })
    expect(await deliveryRow(message.deliveryId)).toMatchObject({ state: "sending", attempt_count: 2 })
    expect(await attemptRows(message.outboxId)).toMatchObject([
      { generation: 1, worker_id: "worker-a", outcome: "accepted", message_id: "late-accept-1" },
      { generation: 2, worker_id: "worker-b", outcome: null, message_id: null },
    ])

    const owner = { outboxEventId: message.outboxId, generation: 2, now: at(403_000) }
    expect(await unitOfWork.execute((tx) => outboxRepository.settleDelivered(tx, owner))).toBe(true)
    expect(await outboxRow(message.outboxId)).toMatchObject({ state: "delivered", locked_by: null })
  })

  test("cancels unsent work together with its delivery and refuses once sending has committed", async () => {
    const unclaimed = await seedMessage({ label: "cancel-unclaimed", topic: "cancel-unclaimed", outboxState: "pending", deliveryState: "queued" })
    const claimed = await seedMessage({ label: "cancel-claimed", topic: "cancel-claimed", outboxState: "pending", deliveryState: "queued" })
    const sending = await seedMessage({ label: "cancel-sending", topic: "cancel-sending", outboxState: "pending", deliveryState: "queued" })
    const now = new Date()
    for (const topic of ["cancel-claimed", "cancel-sending"]) {
      await unitOfWork.execute((tx) => outboxRepository.claimDue(tx, { topics: [topic], workerId: "worker-a", leaseMs: 60_000, limit: 1, now }))
    }
    await unitOfWork.execute(async (tx) => {
      await outboxRepository.markSending(tx, { outboxEventId: sending.outboxId, generation: 1, workerId: "worker-a", now })
      await emailDeliveryRepository.transitionSending(tx, { deliveryId: sending.deliveryId, now })
    })
    const cancelUnsent = (message: Seeded, generation: number): Promise<boolean> =>
      unitOfWork.execute((tx) => outboxRepository.cancelUnsent(tx, { outboxEventId: message.outboxId, generation, now }))

    expect(await cancelUnsent(unclaimed, 0)).toBe(true)
    expect(await cancelUnsent(claimed, 0)).toBe(false)
    expect(await outboxRow(claimed.outboxId)).toMatchObject({ state: "processing", lease_generation: 1 })
    expect(await cancelUnsent(claimed, 1)).toBe(true)
    expect(await cancelUnsent(sending, 1)).toBe(false)
    expect(await cancelUnsent(idsOf("legacy-sending"), 0)).toBe(false)

    for (const message of [unclaimed, claimed]) {
      expect(await outboxRow(message.outboxId)).toMatchObject({ state: "cancelled", locked_by: null })
      expect(await outboxRow(message.outboxId)).toHaveProperty("cancelled_at", expect.any(Date))
      expect(await deliveryRow(message.deliveryId)).toMatchObject({ state: "cancelled" })
    }
    expect(await outboxRow(sending.outboxId)).toMatchObject({ state: "sending", lease_generation: 1 })
    expect(await deliveryRow(sending.deliveryId)).toMatchObject({ state: "sending", cancelled_at: null })
    expect(await attemptRows(sending.outboxId)).toMatchObject([{ generation: 1, worker_id: "worker-a", outcome: null }])
    expect(await outboxRow(idsOf("legacy-sending").outboxId)).toEqual(afterMigration["legacy-sending"]?.outbox)
  })
})
