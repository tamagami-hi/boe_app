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
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createVerificationTokenRepository } from "../../src/repositories/verificationTokenRepository.js"
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
  data: { accepted: boolean } | null
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
        // checker activation uses. Bypassed here: these tests assert routing and
        // persistence, and a real HIBP round-trip would make them network-bound.
        breachChecker: createBypassBreachChecker(),
        config: {
          verificationTokenTtlMs: 24 * 60 * 60 * 1000,
          idempotencyTtlMs: 24 * 60 * 60 * 1000,
          sesConfigurationSet: "boe-transactional",
          signupSharedSecret: SIGNUP_SECRET,
        },
        applicationRepository: createApplicationRepository(),
        consentRepository: createConsentRepository(),
        verificationTokenRepository: createVerificationTokenRepository(),
        emailDeliveryRepository: createEmailDeliveryRepository(),
        outboxRepository: createOutboxRepository(),
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

const rawTokenForApplication = async (email: string): Promise<string> => {
  const result = await pool.query<{ payload: { verificationToken: string } }>(
    "select o.payload as payload from outbox_events o " +
      "join applications a on a.id = o.aggregate_id where a.email_normalized = $1",
    [email],
  )
  const token = result.rows[0]?.payload.verificationToken
  if (token === undefined) throw new Error("no verification token found")
  return token
}

describe("POST /newuser/verify-email (integration)", () => {
  test("consumes a valid token and moves the application to submitted", async () => {
    const email = "verify1@example.com"
    await app.inject({
      method: "POST",
      url: "/newuser",
      headers: signupHeaders,
      payload: { fullName: "Ada Lovelace", email, phone: "+14155551010", acceptedConsents: true },
    })
    const token = await rawTokenForApplication(email)

    const response = await app.inject({
      method: "POST",
      url: "/newuser/verify-email",
      payload: { token },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json<{ data: { verified: boolean } }>().data).toEqual({ verified: true })

    const state = (
      await pool.query<{ state: string; email_verified_at: string | null }>(
        "select state, email_verified_at from applications where email_normalized = $1",
        [email],
      )
    ).rows[0]
    expect(state?.state).toBe("submitted")
    expect(state?.email_verified_at).not.toBeNull()

    // replay is TOKEN_ALREADY_USED
    const replay = await app.inject({
      method: "POST",
      url: "/newuser/verify-email",
      payload: { token },
    })
    expect(replay.statusCode).toBe(409)
    expect(replay.json<SubmitEnvelope>().error?.code).toBe("TOKEN_ALREADY_USED")
  })

  test("rejects an unknown token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/newuser/verify-email",
      payload: { token: "A".repeat(43) },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<SubmitEnvelope>().error?.code).toBe("TOKEN_INVALID")
  })

  test("rejects an expired token with 410", async () => {
    const application = await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name) " +
        "values ('expired1@example.com', '+14155551011', 'Expired User') returning id",
    )
    const applicationId = application.rows[0]?.id
    const expiredToken = cryptoContext.generateVerificationToken()
    await pool.query(
      "insert into verification_tokens (application_id, purpose, token_hash, token_key_version, expires_at, created_at) " +
        "values ($1, 'application_email_verification', $2, $3, now() - interval '1 hour', now() - interval '2 hours')",
      [applicationId, expiredToken.hash, expiredToken.keyVersion],
    )

    const response = await app.inject({
      method: "POST",
      url: "/newuser/verify-email",
      payload: { token: expiredToken.token },
    })
    expect(response.statusCode).toBe(410)
    expect(response.json<SubmitEnvelope>().error?.code).toBe("TOKEN_EXPIRED")
  })
})


/**
 * POST /newuser — the door the externally hosted marketing site posts to
 * (publicly `https://dev-app.beonedge.in/api/newuser`).
 *
 * The value of these tests is proving the adapter still writes the full
 * onboarding row set — application, consents, verification token, queued email,
 * outbox event, audit event — while asking the caller for far less: one flat
 * body, no Idempotency-Key header, no consent version strings.
 */
describe("POST /newuser (integration)", () => {
  const newUserBody = (email: string, phone: string) => ({
    fullName: "Grace Hopper",
    email,
    phone,
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
    expect(response.json<SubmitEnvelope>().data).toEqual({ accepted: true })

    const row = (
      await pool.query<{ id: string; state: string }>(
        "select id, state from applications where email_normalized = $1",
        [email],
      )
    ).rows[0]
    expect(row?.state).toBe("pending_email_verification")
    const id = row?.id

    // Consent versions were resolved server-side, so both documents must still
    // be recorded against the application exactly as the versioned route does.
    expect(
      await countWhere("select count(*)::int as c from application_consents where application_id = $1", [id]),
    ).toBe(2)
    expect(
      await countWhere("select count(*)::int as c from verification_tokens where application_id = $1", [id]),
    ).toBe(1)
    expect(
      await countWhere(
        "select count(*)::int as c from email_deliveries where application_id = $1 and template_key = 'verify_email' and state = 'queued'",
        [id],
      ),
    ).toBe(1)
    expect(await countWhere("select count(*)::int as c from outbox_events where aggregate_id = $1", [id])).toBe(1)
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
 * The caller gate. `/newuser` accepts entirely attacker-chosen input and queues
 * an email for every accepted call, so only the marketing site may reach it —
 * proven by the `x-signup-key` shared secret, not by an Origin header a
 * non-browser client could set to anything.
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

  test("verify-email is reachable without the key — the token is its credential", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/newuser/verify-email",
      payload: { token: "A".repeat(43) },
    })
    // 400 TOKEN_INVALID, not 401: the route ran and judged the token.
    expect(response.statusCode).toBe(400)
    expect(response.json<SubmitEnvelope>().error?.code).toBe("TOKEN_INVALID")
  })
})
