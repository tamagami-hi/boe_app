import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork, type UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { enqueueEmail, type EmailTemplateSubject } from "../../src/domain/email/enqueueEmail.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { loadMigrationFiles, runMigrations, type MigrationFile } from "../../src/scripts/migrate.js"
import { CRYPTO_ENV } from "./passwordMailSupport.js"

const MIGRATION = "072_client_nominee_requests"

const PREVIOUS_USER_KEYS = [
  "password_set_link",
  "password_reset_link",
  "password_app_download",
  "contact_phone_changed",
  "email_change_code",
  "contact_email_changed",
  "admin_message",
  "app_update_notice",
  "investment_recorded",
  "maturity_options",
] as const

let container: StartedPostgreSqlContainer
let pool: Pool
let unitOfWork: UnitOfWork
let migrations: readonly MigrationFile[]
let before: string
let phone = 0

const mailDeps = () => ({
  outboxRepository: createOutboxRepository(),
  emailDeliveryRepository: createEmailDeliveryRepository(),
  crypto: createCryptoContext(parseCryptoKeys(CRYPTO_ENV)),
})

const seedUser = async (nominee: string | null): Promise<string> => {
  phone += 1
  const id = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, nominee_name, nominee_relation) " +
        "values ($1, $2, 'Upgrade Client', 'active', now(), $3, case when $3::text is null then null else 'Spouse' end) returning id",
      [`nominee-requests-${randomUUID()}@example.com`, `+9198765${String(phone).padStart(5, "0")}`, nominee],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("user not seeded")
  return id
}

const queueMail = (template: EmailTemplateSubject, aggregateId: string) =>
  unitOfWork.execute((tx) =>
    enqueueEmail(tx, mailDeps(), {
      recipient: `mail-${randomUUID()}@example.com`,
      template,
      templateVersion: "v1",
      sesConfigurationSet: "boe-transactional",
      eventType: `test.${template.templateKey}`,
      eventVersion: 1,
      aggregateType: "user",
      aggregateId,
      requestId: randomUUID(),
      deduplicationKey: `nominee-requests-migration:${randomUUID()}`,
      payload: { template: template.templateKey },
    }),
  )

const snapshot = async (): Promise<string> =>
  JSON.stringify(
    (
      await pool.query(
        "select (select json_agg(u order by u.id) from users u) as users, " +
          "(select json_agg(d order by d.id) from email_deliveries d) as deliveries, " +
          "(select json_agg(o order by o.id) from outbox_events o) as outbox, " +
          "(select json_agg(a order by a.id) from audit_events a) as audit",
      )
    ).rows[0],
  )

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 4, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  unitOfWork = createUnitOfWork(createDatabase(pool))
  migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations.filter((migration) => migration.version < MIGRATION))

  const withNominee = await seedUser("Meera Rao")
  await seedUser(null)
  for (const templateKey of PREVIOUS_USER_KEYS) await queueMail({ templateKey, userId: withNominee }, withNominee)
  await pool.query(
    "insert into audit_events (actor_type, actor_user_id, command, entity_type, entity_id, request_id, entity_version, metadata) " +
      "values ('user', $1, 'user.nominee_changed', 'user', $1, $2, 1, '{}')",
    [withNominee, randomUUID()],
  )

  before = await snapshot()
  await runMigrations(pool, migrations.filter((migration) => migration.version === MIGRATION))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("nominee requests populated upgrade", () => {
  test("keeps every delivery the previous release queued and every other row exactly as it was", async () => {
    expect(await snapshot()).toBe(before)
    expect((await pool.query("select template_key from email_deliveries")).rowCount).toBe(PREVIOUS_USER_KEYS.length)
    expect((await pool.query("select 1 from client_nominee_requests")).rowCount).toBe(0)
    expect((await pool.query("select version from schema_migrations where version = $1", [MIGRATION])).rowCount).toBe(1)
  })

  test("keeps the previous release's mail and tombstone writes working and accepts only the one new template key", async () => {
    const user = await seedUser("Kiran Rao")
    await queueMail({ templateKey: "maturity_options", userId: user }, user)
    await queueMail({ templateKey: "nominee_request_decided", userId: user }, user)
    await expect(
      pool.query("update email_deliveries set template_key = 'sip_early_exit' where user_id = $1 and template_key = 'maturity_options'", [user]),
    ).rejects.toThrow(/email_deliveries_template_check/u)

    await pool.query(
      "insert into client_nominee_requests (user_id, nominee_name, nominee_relation, created_at) values ($1, 'Asha Rao', 'Daughter', now() - interval '1 day')",
      [user],
    )
    await pool.query("update users set pii_tombstoned_at = now(), account_state = 'closed', closed_at = now() where id = $1", [user])
    expect((await pool.query("select nominee_name from users where id = $1", [user])).rows).toEqual([{ nominee_name: null }])
    expect(
      (await pool.query("select nominee_name, nominee_relation, state, decided_at is not null as decided from client_nominee_requests where user_id = $1", [user]))
        .rows,
    ).toEqual([{ nominee_name: "Tombstoned", nominee_relation: "Tombstoned", state: "withdrawn", decided: true }])
  })
})
