import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { composeBackend } from "../../src/runtime/composition.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"
import { resolveSeedAuthConfig, runSeedAuth } from "../../src/scripts/seedAuth.js"

/**
 * RA-B0 (Option 3) proof: the rearchitected backend boots under the
 * release_manager deploy-shaped environment — legacy `CORS_ORIGIN` (no
 * `WEB_ORIGIN_ALLOWLIST`), no AWS SES/SNS, and a `\n`-escaped PKCS#8 signing key
 * — composes, serves health, serves a public route, and omits the SNS ingress.
 */
let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let dispose: () => Promise<void>

const base64Key = (): string => randomBytes(32).toString("base64")

/** The marketing site's shared secret for POST /newuser in this deploy shape. */
const DEPLOY_SIGNUP_SECRET = "deploy-boot-newuser-shared-secret-0123456789"

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  const connectionString = container.getConnectionUri()

  pool = createPool({ connectionString, poolMax: 5, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
  await runMigrations(pool, await loadMigrationFiles(directory))
  await runSeed(pool)

  const keyPair = await generateKeyPair("ES256", { extractable: true })
  const signingPem = await exportPKCS8(keyPair.privateKey)
  const verificationPem = await exportSPKI(keyPair.publicKey)

  // Deploy-shaped env: mirrors release_manager/BOE_APP/docker-compose.yml's
  // backend env contract (CORS_ORIGIN, DATABASE_URL, no AWS SES/SNS), plus the
  // key material the operator supplies. The signing key is `\n`-escaped as it
  // would be on a single .env line.
  const deployEnv: Record<string, string> = {
    NODE_ENV: "production",
    DATABASE_URL: connectionString,
    CORS_ORIGIN: "https://app.beonedge.test,https://admin.beonedge.test",
    WEB_COOKIE_SECURE: "true",
    ACCESS_TOKEN_ISSUER: "https://api.beonedge.test",
    ACCESS_TOKEN_AUDIENCE: "boe",
    ACCESS_TOKEN_CURRENT_KID: "k1",
    ACCESS_TOKEN_SIGNING_KEY: signingPem.replace(/\n/gu, "\\n"),
    ACCESS_TOKEN_VERIFICATION_KEYS: JSON.stringify({ k1: verificationPem }),
    REFRESH_HMAC_KEY: base64Key(),
    REFRESH_KEY_VERSION: "rt1",
    CSRF_KEY_VERSION: "cs1",
    CURSOR_HMAC_KEY: base64Key(),
    CRYPTO_TOKEN_HASH_KEY: base64Key(),
    CRYPTO_TOKEN_HASH_KEY_VERSION: "th1",
    CRYPTO_CONSENT_IP_HMAC_KEY: base64Key(),
    CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ip1",
    CRYPTO_RECIPIENT_HMAC_KEY: base64Key(),
    CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rh1",
    CRYPTO_RECIPIENT_ENC_KEY: base64Key(),
    CRYPTO_RECIPIENT_ENC_KEY_VERSION: "re1",
    // The marketing site's shared secret for POST /newuser. A deploy without it
    // still boots; /newuser alone refuses callers.
    NEWUSER_SHARED_SECRET: DEPLOY_SIGNUP_SECRET,
    // Intentionally NO AWS_REGION / SNS_TOPIC_ARN / SES_CONFIGURATION_SET.
  }

  const services = composeBackend(deployEnv)
  dispose = services.dispose
  app = createApplication({ logger: false, registerRoutes: services.registerRoutes })
  await app.ready()
}, 220_000)

afterAll(async () => {
  await app.close()
  await dispose()
  await pool.end()
  await container.stop()
})

describe("deploy-shaped boot (RA-B0)", () => {
  test("composes and serves liveness", async () => {
    const live = await app.inject({ method: "GET", url: "/health/live" })
    expect(live.statusCode).toBe(200)
  })

  test("readiness is ready with email intentionally unconfigured", async () => {
    const ready = await app.inject({ method: "GET", url: "/health/ready" })
    expect(ready.statusCode).toBe(200)
    expect(ready.json()).toEqual({ status: "ready", checks: { database: true, email: false } })
  })

  test("serves the public signup door and resolves the seeded consent documents", async () => {
    // The marketing site posts here with no consent version strings, so a 202
    // proves the boot could read the seeded consent_documents rows and stamp
    // the application with both of them. That is a stronger check than reading
    // the documents back: it exercises the write path a real signup takes.
    const response = await app.inject({
      method: "POST",
      url: "/newuser",
      headers: { "x-signup-key": DEPLOY_SIGNUP_SECRET },
      payload: {
        fullName: "Deploy Boot",
        email: "deploy-boot@example.com",
        phone: "+14155559001",
        acceptedConsents: true,
      },
    })
    expect(response.statusCode).toBe(202)

    const consents = await pool.query<{ kind: string }>(
      "select d.kind as kind from application_consents c " +
        "join applications a on a.id = c.application_id " +
        "join consent_documents d on d.id = c.consent_document_id " +
        "where a.email_normalized = $1",
      ["deploy-boot@example.com"],
    )
    expect(consents.rows.map((row) => row.kind).sort()).toEqual(["privacy", "terms"])
  })

  test("omits the SNS provider-event ingress when AWS is not configured", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/provider-events/aws-sns",
      headers: { "content-type": "text/plain" },
      payload: "{}",
    })
    expect(response.statusCode).toBe(404)
  })

  test("seed:auth bootstraps an admin that can log in via web auth", async () => {
    const password = "correct horse battery staple"
    const result = await runSeedAuth(
      pool,
      resolveSeedAuthConfig({
        NODE_ENV: "production",
        SEED_AUTH_ALLOW_PRODUCTION: "true",
        ADMIN_LOGIN_ID: "ops@beonedge.test",
        ADMIN_PASSWORD: password,
      }),
    )
    expect(result.adminSeeded).toBe(true)

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/web/login",
      headers: { origin: "https://admin.beonedge.test" },
      payload: { email: "ops@beonedge.test", password },
    })
    expect(login.statusCode).toBe(200)
    const body = login.json<{ data: { user: { roles: string[]; permissions: string[] } } }>()
    expect(body.data.user.roles).toContain("superadmin")
    expect(body.data.user.permissions).toContain("applications.read")

    // Re-running is idempotent (no duplicate admin, still logs in).
    const rerun = await runSeedAuth(
      pool,
      resolveSeedAuthConfig({
        NODE_ENV: "production",
        SEED_AUTH_ALLOW_PRODUCTION: "true",
        ADMIN_LOGIN_ID: "ops@beonedge.test",
        ADMIN_PASSWORD: password,
      }),
    )
    expect(rerun.adminSeeded).toBe(true)
  })
})
