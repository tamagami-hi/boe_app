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
import { createPasswordRecheckLimiter } from "../../src/auth/passwordRecheckLimiter.js"
import { hashPassword } from "../../src/auth/passwordHasher.js"
import { createCryptoContext, parseCryptoKeys, type CryptoContext } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork, type UnitOfWork } from "../../src/db/database.js"
import type { EmailDelivery, OutboxEvent } from "../../src/db/repositories.js"
import { createPool } from "../../src/db/pool.js"
import { CLIENT_WEB_SCOPE } from "../../src/domain/auth/clientWebAuth.js"
import { CLIENT_NATIVE_SCOPE, nativeLogin } from "../../src/domain/auth/nativeAuth.js"
import { webLogin } from "../../src/domain/auth/webAuth.js"
import { confirmEmailChange } from "../../src/domain/client/emailChange.js"
import { createEmailChangeMailGuard } from "../../src/domain/email/emailChangeMailGuard.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { createEmailChangeRepository } from "../../src/repositories/emailChangeRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createEmailVerificationRepository } from "../../src/repositories/emailVerificationRepository.js"
import { createIdentityLockRepository } from "../../src/repositories/identityLockRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createPasswordTokenRepository } from "../../src/repositories/passwordTokenRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerClientProfileRoutes, type ClientProfileDeps } from "../../src/routes/clientProfileRoutes.js"
import { registerPasswordRoutes } from "../../src/routes/passwordRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

const PASSWORD = "a long and correct client password"
const MAX_ATTEMPTS = 5

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let accessTokenService: AccessTokenService
let unitOfWork: UnitOfWork
let crypto: CryptoContext
let deps: ClientProfileDeps
let passwordHash: string
let phoneCounter = 0

const b64 = (n: number): string => randomBytes(n).toString("base64")
const dataOf = <T>(r: { json: () => unknown }): T => (r.json() as { data: T }).data
const errorOf = (r: { json: () => unknown }): string => (r.json() as { error: { code: string } }).error.code
const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415558${String(phoneCounter).padStart(4, "0")}`
}
const nextEmail = (label: string): string => `${label}-${randomUUID()}@example.com`

interface Client {
  readonly userId: string
  readonly email: string
  readonly token: string
}

const nativeSession = async (userId: string): Promise<string> => {
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [userId],
  )
  return accessTokenService.sign({ sub: userId, sid: session.rows[0]?.id ?? "" })
}

const seedClient = async (): Promise<Client> => {
  const email = nextEmail("client")
  const userId = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, 'Asha Verma', 'active', now()) returning id",
      [email, nextPhone()],
    )
  ).rows[0]?.id
  if (userId === undefined) throw new Error("client not created")
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [userId, passwordHash])
  return { userId, email, token: await nativeSession(userId) }
}

const post = (token: string, url: string, payload: object) =>
  app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}` }, payload })

const requestChange = (client: Client, newEmail: string, currentPassword = PASSWORD) =>
  post(client.token, "/v1/client/profile/email", { newEmail, currentPassword })

const confirm = (client: Client, code: string) => post(client.token, "/v1/client/profile/email/confirm", { code })

const activeRequestId = async (userId: string): Promise<string> => {
  const id = (
    await pool.query<{ id: string }>(
      "select id from email_change_requests where user_id = $1 and consumed_at is null",
      [userId],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("no active request")
  return id
}

const codeOf = async (requestId: string): Promise<string> => {
  const row = (
    await pool.query<{ id: string; ciphertext: Buffer; nonce: Buffer; key_version: string }>(
      "select d.id, p.ciphertext, p.nonce, p.key_version from email_deliveries d " +
        "join outbox_events o on o.id = d.outbox_event_id join email_delivery_payloads p on p.email_delivery_id = d.id " +
        "where o.deduplication_key = $1",
      [`email_change_code:${requestId}`],
    )
  ).rows[0]
  if (row === undefined) throw new Error("no code mail")
  const opened = crypto.decryptDeliveryPayload(row.id, {
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    keyVersion: row.key_version,
  })
  if (opened.kind !== "opened") throw new Error("code mail unreadable")
  return String(opened.payload.code)
}

const emailOf = async (userId: string) =>
  (
    await pool.query<{ email_normalized: string; email_revision: string; email_verification_state: string }>(
      "select email_normalized, email_revision, email_verification_state from users where id = $1",
      [userId],
    )
  ).rows[0]

const rowsMentioning = async (needle: string): Promise<number> => {
  const tables = ["email_change_requests", "outbox_events", "email_deliveries", "audit_events"]
  let total = 0
  for (const table of tables) {
    total += Number(
      (await pool.query<{ n: string }>(`select count(*) as n from ${table} t where t::text like $1`, [`%${needle}%`])).rows[0]?.n,
    )
  }
  return total
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 6, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
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
  deps = {
    accessTokenService,
    database,
    clientWeb: { originAllowlist: [] },
    unitOfWork,
    clock: () => new Date(),
    crypto,
    userRepository: createUserRepository(),
    credentialRepository: createCredentialRepository(),
    emailVerificationRepository: createEmailVerificationRepository(),
    emailChangeRepository: createEmailChangeRepository(),
    passwordTokenRepository: createPasswordTokenRepository(),
    authSessionRepository: createAuthSessionRepository(),
    applicationRepository: createApplicationRepository(),
    identityLockRepository: createIdentityLockRepository(),
    auditRepository: createAuditRepository(),
    outboxRepository: createOutboxRepository(),
    emailDeliveryRepository: createEmailDeliveryRepository(),
    passwordRecheckLimiter: createPasswordRecheckLimiter(() => new Date()),
    config: { sesConfigurationSet: "boe-transactional", codeTtlMs: 600_000, maxAttempts: MAX_ATTEMPTS, resendCooldownMs: 60_000 },
  }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerClientProfileRoutes(instance, deps)
      registerPasswordRoutes(instance, {
        ...deps,
        passwordTokenRepository: createPasswordTokenRepository(),
        authSessionRepository: createAuthSessionRepository(),
        credentialRepository: createCredentialRepository(),
        userRepository: createUserRepository(),
        appUpdate: { releaseRoot: null, downloadBaseUrl: null },
        config: {
          tokenTtlMs: 600_000,
          maxAttempts: MAX_ATTEMPTS,
          requestCooldownMs: 60_000,
          passwordLinks: { clientUrl: "https://app.beonedge.test/reset-password", requireHttps: true },
          sesConfigurationSet: "boe-transactional",
        },
      })
    },
  })
}, 220_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("guessing the current password from a signed-in session", () => {
  test("allows five password checks per client across phone, email, and password changes, then refuses even the right one", async () => {
    const client = await seedClient()
    const other = await seedClient()
    const wrong = "a wrong password that is long enough"
    const newPassword = "a brand new password for this account"
    const before = await pool.query("select password_hash, version from user_credentials where user_id = $1", [client.userId])

    const guesses = [
      await post(client.token, "/v1/client/profile/phone", { phone: nextPhone(), currentPassword: wrong }),
      await requestChange(client, nextEmail("guess"), wrong),
      await post(client.token, "/v1/auth/password/change", { currentPassword: wrong, newPassword }),
      await post(client.token, "/v1/client/profile/phone", { phone: nextPhone(), currentPassword: wrong }),
      await requestChange(client, nextEmail("guess"), wrong),
    ]
    const blocked = [
      await post(client.token, "/v1/auth/password/change", { currentPassword: PASSWORD, newPassword }),
      await post(client.token, "/v1/client/profile/phone", { phone: nextPhone(), currentPassword: PASSWORD }),
      await requestChange(client, nextEmail("blocked")),
    ]
    const unaffected = await requestChange(other, nextEmail("other"))

    expect(guesses.map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401])
    expect(blocked.map((r) => [r.statusCode, errorOf(r)])).toEqual(Array(3).fill([429, "RATE_LIMITED"]))
    expect((await pool.query("select password_hash, version from user_credentials where user_id = $1", [client.userId])).rows).toEqual(before.rows)
    expect(await pool.query("select 1 from email_change_requests where user_id = $1", [client.userId]).then((r) => r.rowCount)).toBe(0)
    expect(unaffected.statusCode).toBe(200)
  })
})

describe("asking to change the email address", () => {
  test("queues a code to the new address only, keeps the target encrypted, and shows the pending change", async () => {
    const client = await seedClient()
    const target = nextEmail("target")

    const response = await requestChange(client, target)

    expect(response.statusCode).toBe(200)
    expect(dataOf(response)).toMatchObject({ status: "code_sent", email: crypto.maskEmail(target) })
    const requestId = await activeRequestId(client.userId)
    const code = await codeOf(requestId)
    expect(code).toMatch(/^[A-Za-z0-9]{6}$/u)
    expect(await rowsMentioning(target)).toBe(0)
    expect(await rowsMentioning(code)).toBe(0)
    const recipient = (
      await pool.query<{ recipient_ciphertext: Buffer; recipient_nonce: Buffer }>(
        "select d.recipient_ciphertext, d.recipient_nonce from email_deliveries d join outbox_events o on o.id = d.outbox_event_id where o.deduplication_key = $1",
        [`email_change_code:${requestId}`],
      )
    ).rows[0]
    expect(crypto.decryptRecipient(recipient?.recipient_ciphertext ?? Buffer.alloc(0), recipient?.recipient_nonce ?? Buffer.alloc(0))).toBe(target)
    expect((await emailOf(client.userId))?.email_normalized).toBe(client.email)
    const profile = await app.inject({ method: "GET", url: "/v1/client/profile", headers: { authorization: `Bearer ${client.token}` } })
    expect(dataOf<{ pendingEmailChange: { email: string } | null }>(profile).pendingEmailChange?.email).toBe(crypto.maskEmail(target))
  })

  test("refuses a wrong password, an address another account holds, and one a pending application holds", async () => {
    const client = await seedClient()
    const other = await seedClient()
    const pendingEmail = nextEmail("pending")
    await pool.query(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at) values ($1, $2, 'Ravi', 'submitted', now())",
      [pendingEmail, nextPhone()],
    )

    const wrong = await requestChange(client, nextEmail("x"), "this is not the right password")
    const taken = await requestChange(client, other.email)
    const reserved = await requestChange(client, pendingEmail)

    expect([wrong.statusCode, errorOf(wrong)]).toEqual([401, "INVALID_CREDENTIALS"])
    expect([taken.statusCode, reserved.statusCode]).toEqual([409, 409])
    expect((await pool.query("select id from email_change_requests where user_id = $1", [client.userId])).rowCount).toBe(0)
  })
})

describe("confirming the email change", () => {
  test("replaces the address, verifies it, and revokes every session, link, code and older request", async () => {
    const client = await seedClient()
    const target = nextEmail("new")
    await pool.query(
      "insert into password_credential_tokens (user_id, purpose, token_hash, token_key_version, expires_at, bound_email_revision, bound_credential_version) " +
        "values ($1, 'reset', $2, 'tk1', now() + interval '10 minutes', 1, 0)",
      [client.userId, randomBytes(32)],
    )
    await requestChange(client, target)
    const code = await codeOf(await activeRequestId(client.userId))
    const before = await emailOf(client.userId)

    const response = await confirm(client, code)

    expect(response.statusCode).toBe(200)
    expect(dataOf(response)).toEqual({ status: "changed", email: target })
    const after = await emailOf(client.userId)
    expect(after).toEqual({
      email_normalized: target,
      email_revision: String(Number(before?.email_revision) + 1),
      email_verification_state: "verified",
    })
    expect((await pool.query("select id from auth_sessions where user_id = $1 and revoked_at is null", [client.userId])).rowCount).toBe(0)
    expect((await pool.query("select id from password_credential_tokens where user_id = $1 and consumed_at is null", [client.userId])).rowCount).toBe(0)
    expect((await pool.query("select id from email_change_requests where user_id = $1 and consumed_at is null", [client.userId])).rowCount).toBe(0)
    const notices = await pool.query<{ payload: Record<string, unknown> }>(
      "select o.payload from outbox_events o join email_deliveries d on d.outbox_event_id = o.id " +
        "where d.user_id = $1 and d.template_key = 'contact_email_changed' order by o.deduplication_key",
      [client.userId],
    )
    expect(notices.rows.map((row) => row.payload.role).sort()).toEqual(["current", "previous"])
    const reused = await app.inject({ method: "GET", url: "/v1/client/profile", headers: { authorization: `Bearer ${client.token}` } })
    expect(reused.statusCode).toBe(401)
  })

  test("counts wrong codes, then locks the request", async () => {
    const client = await seedClient()
    await requestChange(client, nextEmail("locked"))
    const code = await codeOf(await activeRequestId(client.userId))
    const wrongCode = code === "AAAAAA" ? "BBBBBB" : "AAAAAA"

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(errorOf(await confirm(client, wrongCode))).toBe("TOKEN_INVALID")
    }
    const locked = await confirm(client, code)

    expect([locked.statusCode, errorOf(locked)]).toEqual([409, "STATE_CONFLICT"])
    expect((await emailOf(client.userId))?.email_normalized).toBe(client.email)
  })

  test("refuses an expired code", async () => {
    const client = await seedClient()
    await requestChange(client, nextEmail("expired"))
    const requestId = await activeRequestId(client.userId)
    const code = await codeOf(requestId)
    await pool.query("update email_change_requests set expires_at = now() - interval '1 second' where id = $1", [requestId])

    const response = await confirm(client, code)

    expect([response.statusCode, errorOf(response)]).toEqual([410, "TOKEN_EXPIRED"])
    expect((await emailOf(client.userId))?.email_normalized).toBe(client.email)
  })

  test("refuses, and retires, a request made before the password changed", async () => {
    const client = await seedClient()
    await requestChange(client, nextEmail("stale"))
    const code = await codeOf(await activeRequestId(client.userId))
    await pool.query("update user_credentials set version = version + 1 where user_id = $1", [client.userId])

    const response = await confirm(client, code)

    expect(response.statusCode).toBe(409)
    expect((await emailOf(client.userId))?.email_normalized).toBe(client.email)
    expect((await pool.query("select id from email_change_requests where user_id = $1 and consumed_at is null", [client.userId])).rowCount).toBe(0)
  })

  test("a newer request retires the older one, so the older code stops working", async () => {
    const client = await seedClient()
    await requestChange(client, nextEmail("first"))
    const firstCode = await codeOf(await activeRequestId(client.userId))
    await pool.query("update email_change_requests set created_at = created_at - interval '2 minutes' where user_id = $1", [client.userId])
    const second = nextEmail("second")
    await requestChange(client, second)

    const old = await confirm(client, firstCode)

    expect(old.statusCode).toBe(400)
    const secondCode = await codeOf(await activeRequestId(client.userId))
    expect((await confirm(client, secondCode)).statusCode).toBe(200)
    expect((await emailOf(client.userId))?.email_normalized).toBe(second)
  })
})

describe("the worker's guard for the code mail", () => {
  test("lets a live request's code go and cancels one whose request was used or has expired", async () => {
    const client = await seedClient()
    await requestChange(client, nextEmail("guard"))
    const requestId = await activeRequestId(client.userId)
    const guard = createEmailChangeMailGuard({ emailChangeRepository: createEmailChangeRepository() })
    const verdict = (now: Date) =>
      unitOfWork.execute((tx) =>
        guard(tx, {
          event: { payload: { emailChangeRequestId: requestId } } as unknown as OutboxEvent,
          delivery: { user_id: client.userId } as unknown as EmailDelivery,
          now,
        }),
      )

    expect(await verdict(new Date())).toEqual({ kind: "send" })
    expect(await verdict(new Date(Date.now() + 3_600_000))).toEqual({ kind: "cancel", reason: "expired" })
    await pool.query("update email_change_requests set consumed_at = now() where id = $1", [requestId])
    expect(await verdict(new Date())).toEqual({ kind: "cancel", reason: "consumed" })
  })
})

describe("a sign-in that began with the old address", () => {
  const changeDuringLogin = (client: Client, target: string): UnitOfWork => {
    let changed = false
    return {
      execute: async (work) => {
        if (!changed) {
          changed = true
          const code = await codeOf(await activeRequestId(client.userId))
          const outcome = await unitOfWork.execute((tx) =>
            confirmEmailChange(tx, deps, { userId: client.userId, code, requestId: randomUUID() }),
          )
          expect(outcome).toEqual({ kind: "changed", email: target })
        }
        return unitOfWork.execute(work)
      },
    }
  }

  const loginDeps = (client: Client, target: string) => ({
    ...deps,
    authSessionRepository: createAuthSessionRepository(),
    unitOfWork: changeDuringLogin(client, target),
    loginEventRepository: createLoginEventRepository(),
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rt1",
    csrfKeyVersion: "cs1",
    config: { cookieSecure: false, originAllowlist: ["https://app.beonedge.test"] },
  })

  test("cannot create a web session once the address has changed underneath it", async () => {
    const client = await seedClient()
    const target = nextEmail("web-race")
    await requestChange(client, target)
    const sessionsBefore = (await pool.query("select id from auth_sessions where user_id = $1", [client.userId])).rowCount

    const login = webLogin(loginDeps(client, target), CLIENT_WEB_SCOPE, {
      email: client.email,
      password: PASSWORD,
      requestId: randomUUID(),
    })

    await expect(login).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" })
    expect((await pool.query("select id from auth_sessions where user_id = $1", [client.userId])).rowCount).toBe(sessionsBefore)
  })

  test("cannot create an app session once the address has changed underneath it", async () => {
    const client = await seedClient()
    const target = nextEmail("native-race")
    await requestChange(client, target)
    const sessionsBefore = (await pool.query("select id from auth_sessions where user_id = $1", [client.userId])).rowCount

    const login = nativeLogin(loginDeps(client, target), CLIENT_NATIVE_SCOPE, {
      email: client.email,
      password: PASSWORD,
      requestId: randomUUID(),
      device: { installationId: randomUUID(), name: "Pixel", platform: "android", appVersion: "0.15.0" },
    })

    await expect(login).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" })
    expect((await pool.query("select id from auth_sessions where user_id = $1", [client.userId])).rowCount).toBe(sessionsBefore)
  })
})
