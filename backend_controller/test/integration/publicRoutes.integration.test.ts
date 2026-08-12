import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import { createBypassBreachChecker } from "../../src/auth/breachCheck.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { SEED_CONSENT_DOCUMENTS } from "../../src/db/seedCatalog.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createConsentRepository } from "../../src/repositories/consentRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { registerPublicOnboardingRoutes } from "../../src/routes/publicOnboardingRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

import type { CryptoContext } from "../../src/crypto/context.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let cryptoContext: CryptoContext

interface SubmitEnvelope {
  ok: boolean
  data: {
    accepted: boolean
    outcome: "created" | "duplicate_pending" | "duplicate_account"
    verificationEmailQueued: boolean
  } | null
  error: { code: string } | null
  meta: { requestId: string; idempotencyReplay?: boolean }
}

const key = (bytes: number): string => randomBytes(bytes).toString("base64")

// The shared secret the marketing site presents in `x-signup-key`. Long enough
// to satisfy the same minimum the environment schema enforces.
const SIGNUP_SECRET = "test-only-newuser-shared-secret-0123456789"
const signupHeaders = { "x-signup-key": SIGNUP_SECRET }

const countWhere = async (query: string, values: readonly unknown[]): Promise<number> => {
  const result = await pool.query<{ c: number }>(query, values as unknown[])
  return result.rows[0]?.c ?? 0
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

  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
  const migrations = await loadMigrationFiles(directory)
  await runMigrations(pool, migrations)
  await runSeed(pool)

  const database = createDatabase(pool)
  cryptoContext = createCryptoContext(
    parseCryptoKeys({
      CRYPTO_TOKEN_HASH_KEY: key(32),
      CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
      CRYPTO_CONSENT_IP_HMAC_KEY: key(32),
      CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
      CRYPTO_RECIPIENT_HMAC_KEY: key(32),
      CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
      CRYPTO_RECIPIENT_ENC_KEY: key(32),
      CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
    }),
  )

  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerPublicOnboardingRoutes(instance, {
        database,
        unitOfWork: createUnitOfWork(database),
        clock: () => new Date(),
        crypto: cryptoContext,
        // The signup route hashes a password now, so it needs the same breach
        // checker any credential path uses. Bypassed here: these tests assert
        // routing and persistence, and a real HIBP round-trip would make them
        // network-bound.
        breachChecker: createBypassBreachChecker(),
        config: {
          idempotencyTtlMs: 24 * 60 * 60 * 1000,
          signupSharedSecret: SIGNUP_SECRET,
        },
        applicationRepository: createApplicationRepository(),
        consentRepository: createConsentRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
      })
    },
  })
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

/**
 * POST /newuser — the door the externally hosted marketing site posts to
 * (publicly `https://dev-app.beonedge.in/api/newuser`).
 *
 * The value of these tests is proving the adapter still writes the full
 * onboarding row set — application, consents, audit event — while asking the
 * caller for far less: one flat body, no Idempotency-Key header, no consent
 * version strings. Since the onboarding rework nothing is emailed at signup:
 * the application lands directly in `submitted`, and the only mail in the
 * flow is the account-approved/rejected notice after the admin decision.
 */
describe("POST /newuser (integration)", () => {
  const newUserBody = (email: string, phone: string) => ({
    fullName: "Grace Hopper",
    email,
    phone,
    // Required since password-at-signup (migration 024).
    password: "correct-horse-battery-staple",
    acceptedConsents: true as const,
  })

  test("creates the full onboarding row set with no header and no consent versions", async () => {
    const email = "newuser1@example.com"
    const response = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: signupHeaders,
      payload: newUserBody(email, "+14155552001"),
    })

    expect(response.statusCode).toBe(202)
    expect(response.json<SubmitEnvelope>().data).toEqual({
      accepted: true,
      outcome: "created",
      verificationEmailQueued: false,
    })

    const row = (
      await pool.query<{ id: string; state: string; submitted_at: string | null; password_hash: string | null }>(
        "select id, state, submitted_at, password_hash from applications where email_normalized = $1",
        [email],
      )
    ).rows[0]
    expect(row?.state).toBe("submitted")
    expect(row?.submitted_at).not.toBeNull()
    expect(row?.password_hash).toMatch(/^\$argon2id\$/u)
    const id = row?.id

    // Consent versions were resolved server-side, so both documents must still
    // be recorded against the application.
    expect(
      await countWhere("select count(*)::int as c from application_consents where application_id = $1", [id]),
    ).toBe(2)
    // Nothing is emailed at signup: no delivery rows, no outbox events.
    expect(
      await countWhere("select count(*)::int as c from email_deliveries where application_id = $1", [id]),
    ).toBe(0)
    expect(await countWhere("select count(*)::int as c from outbox_events where aggregate_id = $1", [id])).toBe(0)
  })

  test("records the consent versions currently in force", async () => {
    const email = "newuser-consent@example.com"
    await app.inject({ method: "POST", url: "/newuser", headers: signupHeaders, payload: newUserBody(email, "+14155552002") })

    const versions = await pool.query<{ kind: string; version: string }>(
      "select d.kind, d.version from application_consents c " +
        "join applications a on a.id = c.application_id " +
        "join consent_documents d on d.id = c.consent_document_id " +
        "where a.email_normalized = $1 order by d.kind",
      [email],
    )
    const seeded = new Map(SEED_CONSENT_DOCUMENTS.map((document) => [document.kind, document.version]))
    expect(versions.rows).toHaveLength(2)
    for (const row of versions.rows) {
      expect(row.version).toBe(seeded.get(row.kind as "terms" | "privacy"))
    }
  })

  test("collapses a repeated identical submission without a caller-supplied key", async () => {
    // A double-tapped button or a retry after a timed-out response must not
    // produce two applications; the derived key makes that safe.
    const email = "newuser-dup@example.com"
    const payload = newUserBody(email, "+14155552003")

    const first = await app.inject({ method: "POST", url: "/newuser", headers: signupHeaders, payload })
    const second = await app.inject({ method: "POST", url: "/newuser", headers: signupHeaders, payload })

    expect(first.statusCode).toBe(202)
    expect(second.statusCode).toBe(202)
    expect(second.json<SubmitEnvelope>().meta.idempotencyReplay).toBe(true)
    expect(
      await countWhere("select count(*)::int as c from applications where email_normalized = $1", [email]),
    ).toBe(1)
  })

  test("honours a caller-supplied idempotency key", async () => {
    const payload = { ...newUserBody("newuser-key@example.com", "+14155552004"), idempotencyKey: "aws-lead-00000042" }

    const first = await app.inject({ method: "POST", url: "/newuser", headers: signupHeaders, payload })
    const second = await app.inject({ method: "POST", url: "/newuser", headers: signupHeaders, payload })

    expect(first.statusCode).toBe(202)
    expect(second.json<SubmitEnvelope>().meta.idempotencyReplay).toBe(true)
  })

  /*
   * The dead end the marketing site hit. The derived key covered the identity but
   * not how many times it had been decided, and the idempotency record outlives a
   * same-day rejection, so reapplying replayed the rejected submission's 202 and
   * created nothing. The password's exclusion from the key made it inescapable:
   * the breach screen pushes the applicant to change exactly the one input the
   * key ignores.
   */
  test("a resubmission after a rejection creates a new application instead of replaying", async () => {
    const email = "newuser-rejected@example.com"
    const phone = "+14155552010"
    const payload = newUserBody(email, phone)

    const first = await app.inject({ method: "POST", url: "/newuser", headers: signupHeaders, payload })
    expect(first.json<SubmitEnvelope>().data?.outcome).toBe("created")

    await pool.query("update applications set state = 'rejected', decided_at = now() where email_normalized = $1", [
      email,
    ])

    // Same name, same email, same phone, same consents — everything the old key
    // covered — and a different password, which it never covered.
    const second = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: signupHeaders,
      payload: { ...payload, password: "a-completely-different-passphrase" },
    })

    expect(second.statusCode).toBe(202)
    expect(second.json<SubmitEnvelope>().meta.idempotencyReplay).toBeUndefined()
    expect(second.json<SubmitEnvelope>().data).toEqual({
      accepted: true,
      outcome: "created",
      verificationEmailQueued: false,
    })
    // The rejected row is retained; the partial unique index only constrains
    // rows that are not rejected/withdrawn, so the new one coexists with it.
    expect(
      await countWhere("select count(*)::int as c from applications where email_normalized = $1", [email]),
    ).toBe(2)
    expect(
      await countWhere(
        "select count(*)::int as c from applications where email_normalized = $1 and state = 'submitted'",
        [email],
      ),
    ).toBe(1)
  })

  test("a resubmission while the application is in flight is reported as duplicate_pending", async () => {
    const email = "newuser-throttled@example.com"
    const phone = "+14155552012"

    await app.inject({ method: "POST", url: "/newuser", headers: signupHeaders, payload: newUserBody(email, phone) })

    // A different name derives a different key, so this is a genuine second
    // execution rather than a replay — which is what the marketing site saw when
    // a visitor corrected their name and resubmitted.
    const second = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: signupHeaders,
      payload: { ...newUserBody(email, phone), fullName: "Grace C Hopper" },
    })

    // 200, not 202: understood, and deliberately produced nothing.
    expect(second.statusCode).toBe(200)
    expect(second.json<SubmitEnvelope>().data).toEqual({
      accepted: false,
      outcome: "duplicate_pending",
      verificationEmailQueued: false,
    })

    const applicationId = (
      await pool.query<{ id: string }>("select id from applications where email_normalized = $1", [email])
    ).rows[0]?.id
    // The discard leaves a trace: a thrown-away submission is never invisible.
    expect(
      await countWhere(
        "select count(*)::int as c from audit_events where entity_id = $1 and command = 'application.submit_discarded' " +
          "and metadata->>'reason' = 'application_in_flight'",
        [applicationId],
      ),
    ).toBe(1)
  })

  test("a submission for an identity that already has an account reports duplicate_account", async () => {
    const email = "newuser-existing-account@example.com"
    const phone = "+14155552013"
    await pool.query(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) values ($1, $2, $3, 'active', now())",
      [email, phone, "Grace Hopper"],
    )

    const response = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: signupHeaders,
      payload: newUserBody(email, phone),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<SubmitEnvelope>().data).toEqual({
      accepted: false,
      outcome: "duplicate_account",
      verificationEmailQueued: false,
    })
    expect(
      await countWhere("select count(*)::int as c from applications where email_normalized = $1", [email]),
    ).toBe(0)
    // Recorded against the account whose identity was reused; repeated hits here
    // are someone probing which addresses have accounts.
    expect(
      await countWhere(
        "select count(*)::int as c from audit_events a join users u on u.id = a.entity_id " +
          "where u.email_normalized = $1 and a.command = 'application.submit_discarded' " +
          "and a.metadata->>'reason' = 'account_exists'",
        [email],
      ),
    ).toBe(1)
  })

  test("normalises the phone number and rejects one that is not E.164", async () => {
    const spaced = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: signupHeaders,
      payload: newUserBody("newuser-phone@example.com", "+1 (415) 555-2005"),
    })
    expect(spaced.statusCode).toBe(202)
    expect(
      await countWhere("select count(*)::int as c from applications where phone_e164 = $1", ["+14155552005"]),
    ).toBe(1)

    const local = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: signupHeaders,
      payload: newUserBody("newuser-bad-phone@example.com", "4155552006"),
    })
    expect(local.statusCode).toBe(400)
    expect(local.json()).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } })
  })

  test("refuses a submission that did not accept the consents", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: signupHeaders,
      payload: { ...newUserBody("newuser-noconsent@example.com", "+14155552007"), acceptedConsents: false },
    })
    expect(response.statusCode).toBe(400)
    expect(
      await countWhere("select count(*)::int as c from applications where email_normalized = $1", [
        "newuser-noconsent@example.com",
      ]),
    ).toBe(0)
  })

  test("rejects an unknown field rather than silently dropping it", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: signupHeaders,
      payload: { ...newUserBody("newuser-strict@example.com", "+14155552008"), utmSource: "google" },
    })
    expect(response.statusCode).toBe(400)
  })
})

/**
 * The caller gate. `/newuser` accepts entirely attacker-chosen input, so only
 * the marketing site may reach it — proven by the `x-signup-key` shared secret,
 * not by an Origin header a non-browser client could set to anything.
 */
describe("POST /newuser caller authentication (integration)", () => {
  const body = (email: string, phone: string) => ({
    fullName: "Mallory Unknown",
    email,
    phone,
    acceptedConsents: true as const,
  })

  const assertNoApplication = async (email: string): Promise<void> => {
    expect(await countWhere("select count(*)::int as c from applications where email_normalized = $1", [email])).toBe(0)
  }

  test("refuses a caller that presents no key", async () => {
    const email = "newuser-nokey@example.com"
    const response = await app.inject({
      method: "POST",
      url: "/newuser",
      payload: body(email, "+14155553001"),
    })
    expect(response.statusCode).toBe(401)
    expect(response.json<SubmitEnvelope>().error?.code).toBe("AUTHENTICATION_REQUIRED")
    await assertNoApplication(email)
  })

  test("refuses a caller that presents the wrong key", async () => {
    const email = "newuser-badkey@example.com"
    const response = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: { "x-signup-key": `${SIGNUP_SECRET}x` },
      payload: body(email, "+14155553002"),
    })
    expect(response.statusCode).toBe(401)
    await assertNoApplication(email)
  })

  test("refuses a key that is a prefix of the real one", async () => {
    const email = "newuser-prefix@example.com"
    const response = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: { "x-signup-key": SIGNUP_SECRET.slice(0, -1) },
      payload: body(email, "+14155553003"),
    })
    expect(response.statusCode).toBe(401)
    await assertNoApplication(email)
  })

  test("rejects the caller before validating the body, so the contract stays private", async () => {
    // A malformed body with no key must still answer 401, not 400: an
    // unauthenticated caller should not be able to probe the schema.
    const response = await app.inject({
      method: "POST",
      url: "/newuser",
      payload: { nonsense: true },
    })
    expect(response.statusCode).toBe(401)
  })
})
