import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import { hashPassword } from "../../src/auth/passwordHasher.js"
import { createCryptoContext, parseCryptoKeys, type CryptoContext } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork, type UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { decideApplication } from "../../src/domain/admin/decideApplication.js"
import { submitApplication, type SubmitApplicationDeps } from "../../src/domain/onboarding/submitApplication.js"
import { AppError } from "../../src/http/errorCatalog.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createApplicationReviewRepository } from "../../src/repositories/applicationReviewRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createConsentRepository } from "../../src/repositories/consentRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createEmailVerificationRepository } from "../../src/repositories/emailVerificationRepository.js"
import { createIdentityLockRepository, identityLockKeys } from "../../src/repositories/identityLockRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerClientProfileRoutes } from "../../src/routes/clientProfileRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const PASSWORD = "a long and correct client password"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let accessTokenService: AccessTokenService
let unitOfWork: UnitOfWork
let crypto: CryptoContext
let passwordHash: string
let phoneCounter = 0

const b64 = (n: number): string => randomBytes(n).toString("base64")
const dataOf = <T>(r: { json: () => unknown }): T => (r.json() as { data: T }).data
const errorOf = (r: { json: () => unknown }): string => (r.json() as { error: { code: string } }).error.code

const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415557${String(phoneCounter).padStart(4, "0")}`
}
const nextEmail = (label: string): string => `${label}-${randomUUID()}@example.com`

interface Client {
  readonly userId: string
  readonly email: string
  readonly phone: string
  readonly token: string
}

const sessionToken = async (userId: string, channel: "native" | "admin_native"): Promise<string> => {
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1, $2, 'rt1', now() + interval '90 days') returning id",
    [userId, channel],
  )
  return accessTokenService.sign({ sub: userId, sid: session.rows[0]?.id ?? "" })
}

const seedClient = async (): Promise<Client> => {
  const email = nextEmail("client")
  const phone = nextPhone()
  const userId = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, 'Asha Verma', 'active', now()) returning id",
      [email, phone],
    )
  ).rows[0]?.id
  if (userId === undefined) throw new Error("client not created")
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [userId, passwordHash])
  return { userId, email, phone, token: await sessionToken(userId, "native") }
}

const insertApplication = async (state: "submitted" | "approved", email: string, phone: string): Promise<string> => {
  const id = (
    await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at, password_hash) " +
        "values ($1, $2, 'Ravi Kumar', $3::application_state, now(), $4, $5) returning id",
      [email, phone, state, state === "approved" ? new Date() : null, state === "submitted" ? passwordHash : null],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("application not created")
  return id
}

const changePhone = (token: string, phone: string, currentPassword = PASSWORD) =>
  app.inject({
    method: "POST",
    url: "/v1/client/profile/phone",
    headers: { authorization: `Bearer ${token}` },
    payload: { phone, currentPassword },
  })

const phoneOf = async (userId: string): Promise<string | undefined> =>
  (await pool.query<{ phone_e164: string }>("select phone_e164 from users where id = $1", [userId])).rows[0]?.phone_e164

const noticesFor = async (userId: string) =>
  (
    await pool.query<{ template_key: string; payload: Record<string, unknown> }>(
      "select d.template_key, o.payload from email_deliveries d join outbox_events o on o.id = d.outbox_event_id " +
        "where d.user_id = $1 and d.template_key = 'contact_phone_changed' order by d.created_at",
      [userId],
    )
  ).rows

const repositories = () => ({
  applicationRepository: createApplicationRepository(),
  identityLockRepository: createIdentityLockRepository(),
  applicationReviewRepository: createApplicationReviewRepository(),
  userRepository: createUserRepository(),
  credentialRepository: createCredentialRepository(),
  outboxRepository: createOutboxRepository(),
  emailDeliveryRepository: createEmailDeliveryRepository(),
  auditRepository: createAuditRepository(),
  consentRepository: createConsentRepository(),
  crypto,
  clock: () => new Date(),
})

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({
    connectionString: container.getConnectionUri(),
    poolMax: 6,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
  })
  await runMigrations(pool, await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url))))
  await runSeed(pool)
  const database = createDatabase(pool)
  unitOfWork = createUnitOfWork(database)
  passwordHash = await hashPassword(PASSWORD)
  crypto = createCryptoContext(
    parseCryptoKeys({
      CRYPTO_TOKEN_HASH_KEY: b64(32),
      CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
      CRYPTO_CONSENT_IP_HMAC_KEY: b64(32),
      CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
      CRYPTO_RECIPIENT_HMAC_KEY: b64(32),
      CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
      CRYPTO_RECIPIENT_ENC_KEY: b64(32),
      CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
    }),
  )
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerClientProfileRoutes(instance, {
        ...repositories(),
        accessTokenService,
        database,
        clientWeb: { originAllowlist: [] },
        unitOfWork,
        emailVerificationRepository: createEmailVerificationRepository(),
        config: { sesConfigurationSet: "boe-transactional" },
      })
    },
  })
}, 220_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("a client reads their contact details", () => {
  test("from the server, with the phone never labelled verified", async () => {
    const client = await seedClient()

    const response = await app.inject({
      method: "GET",
      url: "/v1/client/profile",
      headers: { authorization: `Bearer ${client.token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(dataOf(response)).toMatchObject({
      userId: client.userId,
      email: client.email,
      phone: client.phone,
      phoneVerified: false,
      emailVerification: "not_started",
    })
  })

  test("is refused without a session and with an admin session", async () => {
    const client = await seedClient()
    const adminToken = await sessionToken(client.userId, "admin_native")

    const anonymous = await app.inject({ method: "GET", url: "/v1/client/profile" })
    const admin = await app.inject({
      method: "GET",
      url: "/v1/client/profile",
      headers: { authorization: `Bearer ${adminToken}` },
    })

    expect(anonymous.statusCode).toBe(401)
    expect(admin.statusCode).toBe(401)
  })
})

describe("a client changes their phone number", () => {
  test("with the current password: the number changes, the version moves on, and a token-free notice is queued", async () => {
    const client = await seedClient()
    const next = nextPhone()

    const response = await changePhone(client.token, next)

    expect(response.statusCode).toBe(200)
    expect(dataOf(response)).toMatchObject({ status: "changed", profile: { phone: next, phoneVerified: false } })
    expect(await phoneOf(client.userId)).toBe(next)
    const notices = await noticesFor(client.userId)
    expect(notices).toEqual([
      { template_key: "contact_phone_changed", payload: { template: "contact_phone_changed", phoneEnding: next.slice(-4) } },
    ])
    expect(JSON.stringify(notices)).not.toContain(next)
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where entity_id = $1 and command = 'user.phone_changed'",
      [client.userId],
    )
    expect(audit.rows).toEqual([{ metadata: { previousEnding: client.phone.slice(-4), newEnding: next.slice(-4) } }])
  })

  test("with a wrong password: refused with INVALID_CREDENTIALS and nothing changes", async () => {
    const client = await seedClient()

    const response = await changePhone(client.token, nextPhone(), "not the right password at all")

    expect(response.statusCode).toBe(401)
    expect(errorOf(response)).toBe("INVALID_CREDENTIALS")
    expect(await phoneOf(client.userId)).toBe(client.phone)
    expect(await noticesFor(client.userId)).toEqual([])
  })

  test("to the number it already has: answered as unchanged, with no notice", async () => {
    const client = await seedClient()

    const response = await changePhone(client.token, client.phone)

    expect(response.statusCode).toBe(200)
    expect(dataOf(response)).toMatchObject({ status: "unchanged" })
    expect(await noticesFor(client.userId)).toEqual([])
  })

  test("to another account's number, or a pending application's: refused and nothing changes", async () => {
    const client = await seedClient()
    const other = await seedClient()
    const pendingPhone = nextPhone()
    await insertApplication("submitted", nextEmail("pending"), pendingPhone)

    const taken = await changePhone(client.token, other.phone)
    const reserved = await changePhone(client.token, pendingPhone)

    expect(taken.statusCode).toBe(409)
    expect(reserved.statusCode).toBe(409)
    expect(errorOf(taken)).toBe("STATE_CONFLICT")
    expect(await phoneOf(client.userId)).toBe(client.phone)
  })

  test("to a number an approved application once used, whose account has moved on: allowed", async () => {
    const client = await seedClient()
    const historical = nextPhone()
    await insertApplication("approved", nextEmail("history"), historical)

    const response = await changePhone(client.token, historical)

    expect(response.statusCode).toBe(200)
    expect(await phoneOf(client.userId)).toBe(historical)
  })

  test("waits for the identity lock that signups, approvals and admin creation take on the same number", async () => {
    const client = await seedClient()
    const contested = nextPhone()
    const [lockKey] = identityLockKeys({ phoneE164: contested })
    const holder = await pool.connect()
    await holder.query("begin")
    await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey])

    let settled = false
    const pending = changePhone(client.token, contested).then((response) => {
      settled = true
      return response
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    const settledWhileHeld = settled
    await holder.query("commit")
    holder.release()
    const response = await pending

    expect(settledWhileHeld).toBe(false)
    expect(response.statusCode).toBe(200)
  })

  test("when two clients race for the same new number, exactly one gets it and the other is refused cleanly", async () => {
    const first = await seedClient()
    const second = await seedClient()
    const contested = nextPhone()

    const [a, b] = await Promise.all([changePhone(first.token, contested), changePhone(second.token, contested)])

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    const holders = await pool.query("select id from users where phone_e164 = $1", [contested])
    expect(holders.rowCount).toBe(1)
  })
})

describe("released contacts and the onboarding paths", () => {
  test("a public signup may use a number its previous owner changed away from", async () => {
    const client = await seedClient()
    const released = client.phone
    expect((await changePhone(client.token, nextPhone())).statusCode).toBe(200)
    const documents = await pool.query<{ kind: "terms" | "privacy"; version: string }>(
      "select kind, version from consent_documents where kind in ('terms', 'privacy') and retired_at is null",
    )

    const outcome = await unitOfWork.execute((tx) =>
      submitApplication(tx, repositories() as unknown as SubmitApplicationDeps, {
        fullName: "Meera Nair",
        emailNormalized: nextEmail("meera"),
        phoneE164: released,
        passwordHash,
        consents: documents.rows.map((row) => ({ kind: row.kind, version: row.version })),
        requestId: randomUUID(),
        clientIp: "203.0.113.7",
        userAgent: null,
      }),
    )

    expect(outcome.kind).toBe("created")
  })

  test("an approval is refused, and writes nothing, when its number now belongs to another account", async () => {
    const reviewer = await seedClient()
    const phone = nextPhone()
    const applicationId = await insertApplication("submitted", nextEmail("applicant"), phone)
    await pool.query(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, 'Raced Account', 'active', now())",
      [nextEmail("raced"), phone],
    )

    const attempt = unitOfWork.execute((tx) =>
      decideApplication(
        tx,
        { ...repositories(), config: { sesConfigurationSet: "boe-transactional" } },
        {
          applicationId,
          reviewerUserId: reviewer.userId,
          decision: "approved",
          apkDownloadUrl: null,
          requestId: randomUUID(),
          idempotencyKey: `decision-${randomUUID()}`,
        },
      ),
    )

    await expect(attempt).rejects.toBeInstanceOf(AppError)
    await expect(attempt).rejects.toMatchObject({ code: "STATE_CONFLICT" })
    const state = await pool.query<{ state: string }>("select state from applications where id = $1", [applicationId])
    expect(state.rows[0]?.state).toBe("submitted")
    expect((await pool.query("select id from users where application_id = $1", [applicationId])).rowCount).toBe(0)
  })
})
