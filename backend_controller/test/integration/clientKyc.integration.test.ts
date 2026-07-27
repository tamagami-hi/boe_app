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
import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { EmailMessage, EmailSender } from "../../src/email/emailSender.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createClientPortfolioRepository } from "../../src/repositories/clientPortfolioRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createKycRepository } from "../../src/repositories/kycRepository.js"
import { createOrderRepository } from "../../src/repositories/orderRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createPaymentRepository } from "../../src/repositories/paymentRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerClientKycRoutes } from "../../src/routes/clientKycRoutes.js"
import { registerClientOrderRoutes } from "../../src/routes/clientOrderRoutes.js"
import { registerClientPortfolioRoutes } from "../../src/routes/clientPortfolioRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let accessTokenService: AccessTokenService
let fundId: string

// Capturing email sender so tests can read the emailed code.
const sentByRecipient = new Map<string, EmailMessage>()
const capturingSender: EmailSender = {
  send: (message) => {
    sentByRecipient.set(message.to, message)
    return Promise.resolve()
  },
}
const codeFor = (email: string): string => {
  const message = sentByRecipient.get(email)
  const match = message === undefined ? null : /([0-9]{6})/u.exec(message.text)
  if (match?.[1] === undefined) throw new Error(`no code emailed to ${email}`)
  return match[1]
}

const dataOf = <T>(r: { json: () => unknown }): T => (r.json() as { data: T }).data
const errorOf = (r: { json: () => unknown }): string => (r.json() as { error: { code: string } }).error.code
const b64 = (n: number): string => randomBytes(n).toString("base64")

const seedActiveUser = async (email: string, phone: string): Promise<{ userId: string; token: string }> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1,$2,'KYC User','active', now()) returning id",
    [email, phone],
  )
  const userId = user.rows[0]!.id
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [userId],
  )
  const token = await accessTokenService.sign({ sub: userId, sid: session.rows[0]!.id })
  return { userId, token }
}

const bearer = (token: string, key?: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  ...(key === undefined ? {} : { "idempotency-key": key }),
})
const kyc = (token: string, action: "start" | "resend") =>
  app.inject({ method: "POST", url: `/v1/client/kyc/${action}`, headers: bearer(token) })
const verify = (token: string, code: string) =>
  app.inject({ method: "POST", url: "/v1/client/kyc/verify", headers: bearer(token), payload: { code } })
const eligibility = (token: string) =>
  app.inject({ method: "GET", url: "/v1/client/eligibility", headers: bearer(token) })

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
  const unitOfWork = createUnitOfWork(database)
  const clock = () => new Date()

  const crypto = createCryptoContext(
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
      registerClientKycRoutes(instance, {
        accessTokenService,
        database,
        unitOfWork,
        clock,
        crypto,
        kycRepository: createKycRepository(),
        userRepository: createUserRepository(),
        auditRepository: createAuditRepository(),
        emailSender: capturingSender,
        config: { codeTtlMs: 600_000, maxAttempts: 5, resendCooldownMs: 60_000, validityMs: 31_536_000_000 },
      })
      registerClientPortfolioRoutes(instance, {
        accessTokenService,
        database,
        clientPortfolioRepository: createClientPortfolioRepository(),
        clock,
        config: { cursorKey: randomBytes(32) },
      })
      registerClientOrderRoutes(instance, {
        accessTokenService,
        database,
        unitOfWork,
        clock,
        orderRepository: createOrderRepository(),
        paymentRepository: createPaymentRepository(),
        userRepository: createUserRepository(),
        outboxRepository: createOutboxRepository(),
        auditRepository: createAuditRepository(),
        idempotencyRepository: createIdempotencyRepository(),
        config: { idempotencyTtlMs: 86_400_000, paymentProvider: "manual", attemptTtlMs: 900_000 },
      })
    },
  })

  // A published fund for the end-to-end invest step.
  const anyUser = await seedActiveUser("fundowner-kyc@example.com", "+14155551700")
  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ('kyc-fund','published', now(), $1) returning id",
    [anyUser.userId],
  )
  fundId = fund.rows[0]!.id
  const disclosure = await pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1,1,'D','b',$2, now(), $3) returning id",
    [fundId, randomBytes(32), anyUser.userId],
  )
  const nav = await pool.query<{ id: string }>(
    "insert into fund_nav_prices (fund_id, nav, as_of_date, revision, published_by_user_id) " +
      "values ($1, 20.00000000, current_date, 1, $2) returning id",
    [fundId, anyUser.userId],
  )
  const version = await pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, minimum_sip_paise, minimum_purchase_paise, disclosure_version_id, initial_nav_price_id, terms_sha256, created_by_user_id) " +
      "values ($1,1,'KYC Fund','equity','grow','moderate', 50000, 100000, $2, $3, $4, $5) returning id",
    [fundId, disclosure.rows[0]!.id, nav.rows[0]!.id, randomBytes(32), anyUser.userId],
  )
  await pool.query("update funds set current_published_version_id = $1 where id = $2", [version.rows[0]!.id, fundId])
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("client email-OTP KYC + eligibility (integration)", () => {
  test("end-to-end: not eligible -> KYC -> eligible -> can invest, in one go", async () => {
    const { token } = await seedActiveUser("client-a@example.com", "+14155551701")

    const before = await eligibility(token)
    expect(before.statusCode).toBe(200)
    const beforeBody = dataOf<{ eligibility: string; reason: string; canInvest: boolean }>(before)
    expect(beforeBody).toMatchObject({ eligibility: "pending_compliance", reason: "kyc_required", canInvest: false })

    const started = await kyc(token, "start")
    expect(started.statusCode).toBe(200)
    expect(dataOf<{ status: string }>(started).status).toBe("code_sent")

    const wrong = await verify(token, "000000")
    // 000000 is astronomically unlikely to match; treat a match as a fluke re-run.
    if (wrong.statusCode !== 200) {
      expect(wrong.statusCode).toBe(400)
      expect(errorOf(wrong)).toBe("TOKEN_INVALID")
    }

    const verified = await verify(token, codeFor("client-a@example.com"))
    expect(verified.statusCode).toBe(200)
    expect(dataOf<{ status: string }>(verified).status).toBe("approved")

    const after = await eligibility(token)
    expect(dataOf<{ eligibility: string; canInvest: boolean }>(after)).toMatchObject({
      eligibility: "eligible",
      canInvest: true,
    })

    const order = await app.inject({
      method: "POST",
      url: "/v1/client/orders",
      headers: bearer(token, randomUUID()),
      payload: { fundId, amountPaise: 500_000 },
    })
    expect(order.statusCode).toBe(201)
    expect(dataOf<{ status: string }>(order).status).toBe("submitted")
  })

  test("verifying an already-approved user is an idempotent no-op success", async () => {
    const { token } = await seedActiveUser("client-b@example.com", "+14155551702")
    await kyc(token, "start")
    await verify(token, codeFor("client-b@example.com"))
    // A second start returns 'approved' (no new code), and the recorded email is stale.
    const restart = await kyc(token, "start")
    expect(dataOf<{ status: string }>(restart).status).toBe("approved")
  })

  test("resend within the cooldown is RATE_LIMITED", async () => {
    const { token } = await seedActiveUser("client-c@example.com", "+14155551703")
    const first = await kyc(token, "start")
    expect(first.statusCode).toBe(200)
    const second = await kyc(token, "resend")
    expect(second.statusCode).toBe(429)
    expect(errorOf(second)).toBe("RATE_LIMITED")
  })

  test("an expired code is TOKEN_EXPIRED", async () => {
    const { userId, token } = await seedActiveUser("client-d@example.com", "+14155551704")
    await kyc(token, "start")
    await pool.query(
      "update kyc_verification_codes set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes' where user_id = $1 and consumed_at is null",
      [userId],
    )
    const response = await verify(token, codeFor("client-d@example.com"))
    expect(response.statusCode).toBe(410)
    expect(errorOf(response)).toBe("TOKEN_EXPIRED")
  })

  test("too many wrong attempts locks the code (STATE_CONFLICT)", async () => {
    const { token } = await seedActiveUser("client-e@example.com", "+14155551705")
    await kyc(token, "start")
    const realCode = codeFor("client-e@example.com")
    const wrongCode = realCode === "111111" ? "222222" : "111111"
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await verify(token, wrongCode)
      expect(response.statusCode).toBe(400)
    }
    const locked = await verify(token, wrongCode)
    expect(locked.statusCode).toBe(409)
    expect(errorOf(locked)).toBe("STATE_CONFLICT")
    // Even the correct code is now locked out until a resend.
    const stillLocked = await verify(token, realCode)
    expect(stillLocked.statusCode).toBe(409)
  })

  test("a missing bearer is rejected", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/client/kyc/start" })
    expect(response.statusCode).toBe(401)
  })
})
