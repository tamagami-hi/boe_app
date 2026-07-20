import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { consentDigest, SEED_CONSENT_DOCUMENTS } from "../../src/db/seedCatalog.js"
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

interface ConsentItem {
  kind: string
  version: string
  publicPath: string
  contentMarkdown: string
  sha256: string
}

interface SubmitEnvelope {
  ok: boolean
  data: { accepted: boolean } | null
  error: { code: string } | null
  meta: { requestId: string; idempotencyReplay?: boolean }
}

const key = (bytes: number): string => randomBytes(bytes).toString("base64")

const submitBody = (email: string, phone: string, termsVersion = "v1") => ({
  fullName: "Ada Lovelace",
  email,
  phone,
  consents: [
    { kind: "terms", version: termsVersion, accepted: true },
    { kind: "privacy", version: "v1", accepted: true },
  ],
})

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
  const all = await loadMigrationFiles(directory)
  await runMigrations(
    pool,
    all.filter((file) => file.version >= "009"),
  )
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
        config: {
          verificationTokenTtlMs: 24 * 60 * 60 * 1000,
          idempotencyTtlMs: 24 * 60 * 60 * 1000,
          sesConfigurationSet: "boe-transactional",
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

describe("GET /v1/public/consent-documents (integration)", () => {
  test("returns the current terms and privacy documents with digests", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/public/consent-documents" })
    expect(response.statusCode).toBe(200)

    const body = response.json<{ ok: boolean; data: { items: ConsentItem[] } }>()
    expect(body.ok).toBe(true)
    expect(body.data.items.map((item) => item.kind).sort()).toEqual(["privacy", "terms"])

    for (const seeded of SEED_CONSENT_DOCUMENTS) {
      const item = body.data.items.find((candidate) => candidate.kind === seeded.kind)
      expect(item?.publicPath).toBe(seeded.publicPath)
      expect(item?.sha256).toBe(consentDigest(seeded.contentMarkdown).toString("hex"))
    }
  })
})

describe("POST /v1/applications (integration)", () => {
  test("atomically creates all onboarding rows on a new submission", async () => {
    const email = "new1@example.com"
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications",
      headers: { "idempotency-key": "key-new-00000001" },
      payload: submitBody(email, "+14155551001"),
    })

    expect(response.statusCode).toBe(202)
    const body = response.json<SubmitEnvelope>()
    expect(body.data).toEqual({ accepted: true })
    expect(body.meta.idempotencyReplay).toBeUndefined()

    const applicationId = (
      await pool.query<{ id: string; state: string }>(
        "select id, state from applications where email_normalized = $1",
        [email],
      )
    ).rows[0]
    expect(applicationId?.state).toBe("pending_email_verification")
    const id = applicationId?.id
    expect(await countWhere("select count(*)::int as c from application_consents where application_id = $1", [id])).toBe(2)
    expect(await countWhere("select count(*)::int as c from verification_tokens where application_id = $1", [id])).toBe(1)
    expect(
      await countWhere(
        "select count(*)::int as c from email_deliveries where application_id = $1 and template_key = 'verify_email' and state = 'queued'",
        [id],
      ),
    ).toBe(1)
    expect(await countWhere("select count(*)::int as c from outbox_events where aggregate_id = $1", [id])).toBe(1)
    expect(await countWhere("select count(*)::int as c from audit_events where entity_id = $1", [id])).toBe(1)
  })

  test("replays the same response for a repeated idempotency key", async () => {
    const email = "replay1@example.com"
    const payload = submitBody(email, "+14155551002")
    const headers = { "idempotency-key": "key-replay-0001" }

    const first = await app.inject({ method: "POST", url: "/v1/applications", headers, payload })
    const second = await app.inject({ method: "POST", url: "/v1/applications", headers, payload })

    expect(first.statusCode).toBe(202)
    expect(second.statusCode).toBe(202)
    expect(second.json<SubmitEnvelope>().meta.idempotencyReplay).toBe(true)
    expect(await countWhere("select count(*)::int as c from applications where email_normalized = $1", [email])).toBe(1)
  })

  test("treats a duplicate identity as a uniform no-op", async () => {
    const email = "dup1@example.com"
    await app.inject({
      method: "POST",
      url: "/v1/applications",
      headers: { "idempotency-key": "key-dup-000001a" },
      payload: submitBody(email, "+14155551003"),
    })
    const second = await app.inject({
      method: "POST",
      url: "/v1/applications",
      headers: { "idempotency-key": "key-dup-000001b" },
      payload: submitBody(email, "+14155551003"),
    })

    expect(second.statusCode).toBe(202)
    expect(second.json<SubmitEnvelope>().data).toEqual({ accepted: true })
    expect(await countWhere("select count(*)::int as c from applications where email_normalized = $1", [email])).toBe(1)
  })

  test("rejects a missing Idempotency-Key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications",
      payload: submitBody("nokey@example.com", "+14155551004"),
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<SubmitEnvelope>().error?.code).toBe("VALIDATION_FAILED")
  })

  test("rejects a stale consent version", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications",
      headers: { "idempotency-key": "key-stale-00001" },
      payload: submitBody("stale1@example.com", "+14155551005", "v2"),
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<SubmitEnvelope>().error?.code).toBe("VALIDATION_FAILED")
    expect(
      await countWhere("select count(*)::int as c from applications where email_normalized = $1", ["stale1@example.com"]),
    ).toBe(0)
  })
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

describe("POST /v1/applications/verify-email (integration)", () => {
  test("consumes a valid token and moves the application to submitted", async () => {
    const email = "verify1@example.com"
    await app.inject({
      method: "POST",
      url: "/v1/applications",
      headers: { "idempotency-key": "key-verify-0001" },
      payload: submitBody(email, "+14155551010"),
    })
    const token = await rawTokenForApplication(email)

    const response = await app.inject({
      method: "POST",
      url: "/v1/applications/verify-email",
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
      url: "/v1/applications/verify-email",
      payload: { token },
    })
    expect(replay.statusCode).toBe(409)
    expect(replay.json<SubmitEnvelope>().error?.code).toBe("TOKEN_ALREADY_USED")
  })

  test("rejects an unknown token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications/verify-email",
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
      url: "/v1/applications/verify-email",
      payload: { token: expiredToken.token },
    })
    expect(response.statusCode).toBe(410)
    expect(response.json<SubmitEnvelope>().error?.code).toBe("TOKEN_EXPIRED")
  })
})
