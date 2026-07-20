import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { sql } from "kysely"
import type { Kysely } from "kysely"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { Database } from "../../src/db/types.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let database: Kysely<Database>

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
  database = createDatabase(pool)
}, 200_000)

afterAll(async () => {
  await database.destroy()
  await container.stop()
})

describe("PostgreSQL foundation (integration)", () => {
  test("executes a query through the typed pool", async () => {
    const result = await sql<{ one: number }>`select 1 as one`.execute(database)
    expect(result.rows[0]?.one).toBe(1)
  })

  test("commits work inside a unit-of-work transaction", async () => {
    const unitOfWork = createUnitOfWork(database)
    await unitOfWork.execute(async (transaction) => {
      await sql`create table committed_probe (id integer primary key)`.execute(transaction)
      await sql`insert into committed_probe (id) values (1)`.execute(transaction)
    })

    const rows = await sql<{ id: number }>`select id from committed_probe`.execute(database)
    expect(rows.rows).toEqual([{ id: 1 }])
  })

  test("rolls back the whole transaction when the operation throws", async () => {
    const unitOfWork = createUnitOfWork(database)
    await sql`create table rollback_probe (id integer primary key)`.execute(database)

    await expect(
      unitOfWork.execute(async (transaction) => {
        await sql`insert into rollback_probe (id) values (1)`.execute(transaction)
        throw new Error("forced rollback")
      }),
    ).rejects.toThrow("forced rollback")

    const rows = await sql<{ id: number }>`select id from rollback_probe`.execute(database)
    expect(rows.rows).toEqual([])
  })

  test("applies migrations idempotently and records them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "boe-mig-int-"))
    await writeFile(
      join(directory, "001_probe.sql"),
      "create table migrate_probe (id integer primary key);",
    )
    const files = await loadMigrationFiles(directory)

    expect(await runMigrations(pool, files)).toEqual(["001_probe.sql"])
    expect(await runMigrations(pool, files)).toEqual([])

    const recorded = await sql<{ version: string }>`select version from schema_migrations`.execute(
      database,
    )
    expect(recorded.rows).toEqual([{ version: "001_probe" }])
  })
})

describe("canonical public-onboarding schema (BE-007a)", () => {
  beforeAll(async () => {
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const all = await loadMigrationFiles(directory)
    const canonical = all.filter((file) => file.version >= "009")
    await runMigrations(pool, canonical)
  }, 60_000)

  test("enforces one active application per email but allows reuse after rejection", async () => {
    await pool.query(
      "insert into applications (email_normalized, phone_e164, full_name) values ($1, $2, $3)",
      ["a@example.com", "+14155550100", "Ada Lovelace"],
    )
    await expect(
      pool.query(
        "insert into applications (email_normalized, phone_e164, full_name) values ($1, $2, $3)",
        ["a@example.com", "+14155550101", "Ada Two"],
      ),
    ).rejects.toThrow()

    await pool.query(
      "update applications set state = 'rejected', decided_at = now() where email_normalized = $1",
      ["a@example.com"],
    )
    await pool.query(
      "insert into applications (email_normalized, phone_e164, full_name) values ($1, $2, $3)",
      ["a@example.com", "+14155550102", "Ada Three"],
    )
  })

  test("rejects a malformed E.164 phone", async () => {
    await expect(
      pool.query(
        "insert into applications (email_normalized, phone_e164, full_name) values ($1, $2, $3)",
        ["b@example.com", "5550100", "Bad Phone"],
      ),
    ).rejects.toThrow()
  })

  test("requires the consent digest to equal SHA-256 of the markdown", async () => {
    await expect(
      pool.query(
        "insert into consent_documents (kind, version, public_path, content_markdown, content_sha256, published_at) " +
          "values ('terms', 'v1', '/legal/terms', 'hello', decode('00', 'hex'), now())",
      ),
    ).rejects.toThrow()

    await pool.query(
      "insert into consent_documents (kind, version, public_path, content_markdown, content_sha256, published_at) " +
        "values ('terms', 'v1', '/legal/terms', 'hello', digest('hello', 'sha256'), now())",
    )
  })

  test("allows only one pending verification token per application", async () => {
    const application = await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name) " +
        "values ('c@example.com', '+14155550200', 'Verify User') returning id",
    )
    const applicationId = application.rows[0]?.id

    await pool.query(
      "insert into verification_tokens (application_id, purpose, token_hash, token_key_version, expires_at) " +
        "values ($1, 'application_email_verification', decode(repeat('ab', 32), 'hex'), 'k1', now() + interval '1 day')",
      [applicationId],
    )
    await expect(
      pool.query(
        "insert into verification_tokens (application_id, purpose, token_hash, token_key_version, expires_at) " +
          "values ($1, 'application_email_verification', decode(repeat('cd', 32), 'hex'), 'k1', now() + interval '1 day')",
        [applicationId],
      ),
    ).rejects.toThrow()
  })

  test("enforces identity uniqueness and credential/review/invite invariants (BE-007b)", async () => {
    const application = await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name) " +
        "values ('d@example.com', '+14155550300', 'Approved User') returning id",
    )
    const applicationId = application.rows[0]?.id
    const user = await pool.query<{ id: string }>(
      "insert into users (application_id, email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, 'd@example.com', '+14155550300', 'Approved User', 'active', now()) returning id",
      [applicationId],
    )
    const userId = user.rows[0]?.id

    // duplicate user email rejected
    await expect(
      pool.query(
        "insert into users (email_normalized, phone_e164, full_name) values ('d@example.com', '+14155550399', 'Dup')",
      ),
    ).rejects.toThrow()

    // non-Argon2id credential hash rejected; a valid encoded hash is accepted
    await expect(
      pool.query("insert into user_credentials (user_id, password_hash) values ($1, 'plaintext')", [
        userId,
      ]),
    ).rejects.toThrow()
    await pool.query(
      "insert into user_credentials (user_id, password_hash) values ($1, '$argon2id$v=19$m=65536,t=3,p=1$abc$def')",
      [userId],
    )

    // one review per application
    await pool.query(
      "insert into application_reviews (application_id, reviewer_user_id, decision, reason_code, request_id, idempotency_key) " +
        "values ($1, $2, 'approved', 'ok', gen_random_uuid(), 'idem-1')",
      [applicationId, userId],
    )
    await expect(
      pool.query(
        "insert into application_reviews (application_id, reviewer_user_id, decision, reason_code, request_id, idempotency_key) " +
          "values ($1, $2, 'approved', 'ok', gen_random_uuid(), 'idem-2')",
        [applicationId, userId],
      ),
    ).rejects.toThrow()

    // one pending activation invite per user (composite ownership FK)
    await pool.query(
      "insert into activation_invites (user_id, application_id, token_hash, token_key_version, expires_at) " +
        "values ($1, $2, decode(repeat('ab', 32), 'hex'), 'k1', now() + interval '2 days')",
      [userId, applicationId],
    )
    await expect(
      pool.query(
        "insert into activation_invites (user_id, application_id, token_hash, token_key_version, expires_at) " +
          "values ($1, $2, decode(repeat('cd', 32), 'hex'), 'k1', now() + interval '2 days')",
        [userId, applicationId],
      ),
    ).rejects.toThrow()
  })

  test("rejects a password-reset verification token referencing an unknown user", async () => {
    await expect(
      pool.query(
        "insert into verification_tokens (user_id, purpose, token_hash, token_key_version, expires_at) " +
          "values (gen_random_uuid(), 'password_reset', decode(repeat('ef', 32), 'hex'), 'k1', now() + interval '1 day')",
      ),
    ).rejects.toThrow()
  })

  test("enforces session and refresh-token invariants (BE-007c)", async () => {
    const user = await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ('e@example.com', '+14155550400', 'Session User', 'active', now()) returning id",
    )
    const userId = user.rows[0]?.id

    const session = await pool.query<{ id: string }>(
      "insert into auth_sessions (user_id, channel, device_id_hash, refresh_key_version, expires_at) " +
        "values ($1, 'native', decode(repeat('11', 32), 'hex'), 'rk1', now() + interval '30 days') returning id",
      [userId],
    )
    const sessionId = session.rows[0]?.id

    // one active native session per user+device
    await expect(
      pool.query(
        "insert into auth_sessions (user_id, channel, device_id_hash, refresh_key_version, expires_at) " +
          "values ($1, 'native', decode(repeat('11', 32), 'hex'), 'rk1', now() + interval '30 days')",
        [userId],
      ),
    ).rejects.toThrow()

    // native session must not carry CSRF fields
    await expect(
      pool.query(
        "insert into auth_sessions (user_id, channel, refresh_key_version, csrf_token_hash, csrf_key_version, expires_at) " +
          "values ($1, 'native', 'rk1', decode(repeat('22', 32), 'hex'), 'ck1', now() + interval '30 days')",
        [userId],
      ),
    ).rejects.toThrow()

    // web session must carry CSRF
    await expect(
      pool.query(
        "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
          "values ($1, 'web', 'rk1', now() + interval '30 days')",
        [userId],
      ),
    ).rejects.toThrow()

    // one current (unused/unrevoked) refresh token per session
    await pool.query(
      "insert into auth_refresh_tokens (session_id, user_id, generation, token_hash, token_key_version, expires_at) " +
        "values ($1, $2, 0, decode(repeat('33', 32), 'hex'), 'rk1', now() + interval '30 days')",
      [sessionId, userId],
    )
    await expect(
      pool.query(
        "insert into auth_refresh_tokens (session_id, user_id, generation, token_hash, token_key_version, expires_at) " +
          "values ($1, $2, 1, decode(repeat('44', 32), 'hex'), 'rk1', now() + interval '30 days')",
        [sessionId, userId],
      ),
    ).rejects.toThrow()

    // deleting the session cascades to its refresh tokens
    await pool.query("delete from auth_sessions where id = $1", [sessionId])
    const remaining = await pool.query<{ c: number }>(
      "select count(*)::int as c from auth_refresh_tokens where session_id = $1",
      [sessionId],
    )
    expect(remaining.rows[0]?.c).toBe(0)
  })

  test("enforces RBAC, maker-checker, idempotency, rate-limit, and hold invariants (BE-007d)", async () => {
    const maker = await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ('f@example.com', '+14155550500', 'Maker User', 'active', now()) returning id",
    )
    const makerId = maker.rows[0]?.id
    const checker = await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ('g@example.com', '+14155550501', 'Checker User', 'active', now()) returning id",
    )
    const checkerId = checker.rows[0]?.id

    // role code must be snake_case; duplicate code rejected
    await expect(pool.query("insert into roles (code, name) values ('Bad Code', 'x')")).rejects.toThrow()
    const role = await pool.query<{ id: string }>(
      "insert into roles (code, name) values ('onboarding', 'Onboarding') returning id",
    )
    const roleId = role.rows[0]?.id
    await expect(pool.query("insert into roles (code, name) values ('onboarding', 'Dup')")).rejects.toThrow()

    const permission = await pool.query<{ id: string }>(
      "insert into permissions (code, description) values ('applications.review', 'Review apps') returning id",
    )
    const permissionId = permission.rows[0]?.id

    // one active role-permission grant
    await pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) values ($1, $2, $3)",
      [roleId, permissionId, makerId],
    )
    await expect(
      pool.query(
        "insert into role_permissions (role_id, permission_id, granted_by_user_id) values ($1, $2, $3)",
        [roleId, permissionId, makerId],
      ),
    ).rejects.toThrow()

    // maker must differ from checker
    await expect(
      pool.query(
        "insert into approval_actions (action_type, target_type, target_id, target_version, canonical_payload, payload_hash, maker_user_id, maker_reason, checker_user_id, expires_at) " +
          "values ('rbac.permissions.change', 'role', gen_random_uuid(), 1, '{}'::jsonb, decode(repeat('aa', 32), 'hex'), $1, 'a valid reason', $1, now() + interval '1 day')",
        [makerId],
      ),
    ).rejects.toThrow()

    // action_type must be in the closed set
    await expect(
      pool.query(
        "insert into approval_actions (action_type, target_type, target_id, target_version, canonical_payload, payload_hash, maker_user_id, maker_reason, expires_at) " +
          "values ('not.allowed', 'role', gen_random_uuid(), 1, '{}'::jsonb, decode(repeat('aa', 32), 'hex'), $1, 'a valid reason', now() + interval '1 day')",
        [makerId],
      ),
    ).rejects.toThrow()

    // a well-formed approval action is accepted
    await pool.query(
      "insert into approval_actions (action_type, target_type, target_id, target_version, canonical_payload, payload_hash, maker_user_id, maker_reason, checker_user_id, checker_reason, expires_at) " +
        "values ('rbac.permissions.change', 'role', gen_random_uuid(), 1, '{}'::jsonb, decode(repeat('bb', 32), 'hex'), $1, 'a valid reason', $2, 'approved reason', now() + interval '1 day')",
      [makerId, checkerId],
    )

    // idempotency scope/key uniqueness
    await pool.query(
      "insert into idempotency_records (actor_scope, http_method, route_template, key, request_hash, response_status, response_body, expires_at) " +
        "values ('user:1', 'POST', '/v1/applications', 'k1', decode(repeat('cc', 32), 'hex'), 202, '{}'::jsonb, now() + interval '1 day')",
    )
    await expect(
      pool.query(
        "insert into idempotency_records (actor_scope, http_method, route_template, key, request_hash, response_status, response_body, expires_at) " +
          "values ('user:1', 'POST', '/v1/applications', 'k1', decode(repeat('dd', 32), 'hex'), 202, '{}'::jsonb, now() + interval '1 day')",
      ),
    ).rejects.toThrow()

    // rate-limit count must be positive
    await expect(
      pool.query(
        "insert into rate_limit_windows (bucket, key_hash, window_start, count, expires_at) " +
          "values ('b', decode(repeat('ee', 32), 'hex'), now(), 0, now() + interval '1 minute')",
      ),
    ).rejects.toThrow()

    // legal-hold entity_type allowlist + one unreleased per entity
    await expect(
      pool.query(
        "insert into legal_holds (entity_type, entity_id, reason, placed_by) values ('not_allowed', gen_random_uuid(), 'a valid reason here', $1)",
        [makerId],
      ),
    ).rejects.toThrow()
    const held = await pool.query<{ id: string }>("select gen_random_uuid() as id")
    const entityId = held.rows[0]?.id
    await pool.query(
      "insert into legal_holds (entity_type, entity_id, reason, placed_by) values ('user', $1, 'a valid reason here', $2)",
      [entityId, makerId],
    )
    await expect(
      pool.query(
        "insert into legal_holds (entity_type, entity_id, reason, placed_by) values ('user', $1, 'another valid reason', $2)",
        [entityId, makerId],
      ),
    ).rejects.toThrow()
  })
})
