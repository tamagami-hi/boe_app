import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService } from "../../src/auth/accessToken.js"
import { hashPassword } from "../../src/auth/passwordHasher.js"
import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import type { CryptoContext } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import type { UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { dispatchDueDeliveries, type SendGuard } from "../../src/domain/email/dispatchDueDeliveries.js"
import { CLAIMED_EMAIL_TOPICS, SEALED_EMAIL_TOPIC } from "../../src/domain/email/emailTopics.js"
import { enqueueEmail } from "../../src/domain/email/enqueueEmail.js"
import { recoverExpiredDeliveries } from "../../src/domain/email/recoverExpiredDeliveries.js"
import type { EmailMessage, EmailSender } from "../../src/email/emailSender.js"
import { MAX_ATTEMPTS } from "../../src/email/retrySchedule.js"
import { createTransactionalEmailSender } from "../../src/email/transactionalEmailSender.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createApplicationReviewRepository } from "../../src/repositories/applicationReviewRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createEmailSuppressionRepository } from "../../src/repositories/emailSuppressionRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerAdminIdentityRoutes, type AdminIdentityDeps } from "../../src/routes/adminIdentityRoutes.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { composeEmailDispatchWorker } from "../../src/runtime/workerComposition.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"
import { createIdentityLockRepository } from "../../src/repositories/identityLockRepository.js"

const PASSWORD = "correct horse battery staple"
const ORIGIN = "https://admin.beonedge.test"
const HOUR_MS = 3_600_000
const SECRET = "secret-token-9f2c"
const SECRET_URL = `https://downloads.test/${SECRET}/boe.apk`

type Row = Record<string, unknown>

interface Queued {
  readonly outboxId: string
  readonly deliveryId: string
  readonly applicationId: string
  readonly userId: string
  readonly email: string
}

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let unitOfWork: UnitOfWork
let crypto: CryptoContext
let phoneCounter = 0

const outboxRepository = createOutboxRepository()
const emailDeliveryRepository = createEmailDeliveryRepository()
const emailSuppressionRepository = createEmailSuppressionRepository()
const key = (): string => randomBytes(32).toString("base64")
const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data

const CRYPTO_ENV = {
  CRYPTO_TOKEN_HASH_KEY: key(),
  CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
  CRYPTO_CONSENT_IP_HMAC_KEY: key(),
  CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
  CRYPTO_RECIPIENT_HMAC_KEY: key(),
  CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
  CRYPTO_RECIPIENT_ENC_KEY: key(),
  CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
}

const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415557${String(phoneCounter).padStart(4, "0")}`
}

const queueSealed = async (label: string, options: { readonly templateVersion?: string } = {}): Promise<Queued> => {
  const email = `${label}-${randomUUID()}@example.com`
  const phone = nextPhone()
  const applicationId = (
    await pool.query<{ id: string }>(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
        "values ($1, $2, 'Ada Lovelace', 'approved', now(), now()) returning id",
      [email, phone],
    )
  ).rows[0]?.id
  const userId = (
    await pool.query<{ id: string }>(
      "insert into users (application_id, email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, $3, 'Ada Lovelace', 'active', now()) returning id",
      [applicationId, email, phone],
    )
  ).rows[0]?.id
  if (applicationId === undefined || userId === undefined) throw new Error(`seed rows not created for ${label}`)

  const queued = await unitOfWork.execute((tx) =>
    enqueueEmail(
      tx,
      { outboxRepository, emailDeliveryRepository, crypto },
      {
        recipient: email,
        template: { templateKey: "account_approved", userId, applicationId },
        templateVersion: options.templateVersion ?? "v1",
        sesConfigurationSet: "boe-transactional",
        eventType: "user.account_approved",
        eventVersion: 1,
        aggregateType: "user",
        aggregateId: userId,
        requestId: randomUUID(),
        deduplicationKey: `account_approved:${userId}`,
        payload: { template: "account_approved" },
        sealedPayload: { downloadUrl: SECRET_URL },
      },
    ),
  )
  return { outboxId: queued.outbox.id, deliveryId: queued.delivery.id, applicationId, userId, email }
}

const first = async (text: string, values: readonly unknown[]): Promise<Row> =>
  (await pool.query<Row>(text, [...values])).rows[0] ?? {}

const outboxRow = (m: Queued): Promise<Row> => first("select * from outbox_events where id = $1", [m.outboxId])
const deliveryRow = (m: Queued): Promise<Row> => first("select * from email_deliveries where id = $1", [m.deliveryId])
const payloadRow = (m: Queued): Promise<Row> =>
  first("select * from email_delivery_payloads where email_delivery_id = $1", [m.deliveryId])
const attemptRows = async (m: Queued): Promise<Row[]> =>
  (await pool.query<Row>("select * from email_send_attempts where outbox_event_id = $1 order by generation", [m.outboxId])).rows

const setAttemptCounts = async (m: Queued, count: number): Promise<void> => {
  await pool.query("update outbox_events set attempt_count = $2 where id = $1", [m.outboxId, count])
  await pool.query("update email_deliveries set attempt_count = $2 where id = $1", [m.deliveryId, count])
}

const expectScrubbed = (payload: Row): void => {
  expect(payload).toMatchObject({ ciphertext: null, nonce: null, scrubbed_at: expect.any(Date) as Date })
}

const expectSealed = (payload: Row): void => {
  expect(Buffer.isBuffer(payload.ciphertext)).toBe(true)
  expect(Buffer.isBuffer(payload.nonce)).toBe(true)
  expect(payload.scrubbed_at).toBeNull()
}

const SCANNED_TABLES = ["outbox_events", "email_deliveries", "email_send_attempts", "email_delivery_payloads", "audit_events"]

const rowsMentioning = async (needle: string): Promise<number> => {
  let total = 0
  for (const table of SCANNED_TABLES) {
    total += (await pool.query<{ c: number }>(`select count(*)::int as c from ${table} t where t::text like $1`, [`%${needle}%`])).rows[0]?.c ?? 0
  }
  return total
}

type Behaviour = "accept" | "refuse" | "time_out"

const transport = (behaviour: Behaviour): EmailSender & { readonly messages: EmailMessage[] } => {
  const messages: EmailMessage[] = []
  return {
    messages,
    send: (message) => {
      messages.push(message)
      if (behaviour === "refuse") return Promise.reject(Object.assign(new Error("no such user"), { responseCode: 550 }))
      if (behaviour === "time_out") return Promise.reject(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }))
      return Promise.resolve({ messageId: `<sealed-${randomUUID()}@mailbox>` })
    },
  }
}

const dispatch = (sender: EmailSender, clock: () => Date = () => new Date()) =>
  dispatchDueDeliveries({
    unitOfWork,
    outboxRepository,
    emailDeliveryRepository,
    emailSuppressionRepository,
    sender: createTransactionalEmailSender({ sender, templates: { supportAddress: null } }),
    crypto,
    sendGuards: new Map<string, SendGuard>(),
    clock,
    config: {
      topics: CLAIMED_EMAIL_TOPICS,
      workerId: "worker-sealed",
      leaseMs: 30_000,
      claimLimit: 50,
      messageBudgetMs: 25_000,
      passBudgetMs: 35_000,
    },
  })

const cookieJar = (setCookie: string | string[] | undefined): Record<string, string> => {
  const list = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  const jar: Record<string, string> = {}
  for (const cookie of list) {
    const pair = cookie.split(";")[0] ?? ""
    const index = pair.indexOf("=")
    if (index !== -1) jar[pair.slice(0, index)] = pair.slice(index + 1)
  }
  return jar
}

const adminCookie = async (email: string): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/web/login",
    headers: { origin: ORIGIN },
    payload: { email, password: PASSWORD },
  })
  expect(response.statusCode).toBe(200)
  return Object.entries(cookieJar(response.headers["set-cookie"]))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
}

const createAdmin = async (email: string): Promise<void> => {
  const userId = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, 'Admin User', 'active', now()) returning id",
      [email, nextPhone()],
    )
  ).rows[0]?.id as string
  await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [userId, await hashPassword(PASSWORD)])
  for (const permission of SEED_ROLE_PERMISSIONS.onboarding ?? []) {
    await pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) " +
        "select r.id, p.id, $1 from roles r, permissions p where r.code = 'onboarding' and p.code = $2 on conflict do nothing",
      [userId, permission],
    )
  }
  await pool.query("insert into user_roles (user_id, role_id, granted_by_user_id) select $1, id, $1 from roles where code = 'onboarding'", [userId])
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
  await runMigrations(pool, await loadMigrationFiles(directory))
  await runSeed(pool)

  const database = createDatabase(pool)
  unitOfWork = createUnitOfWork(database)
  crypto = createCryptoContext(parseCryptoKeys(CRYPTO_ENV))

  const keyPair = await generateKeyPair("ES256", { extractable: true })
  const webAuth: WebAuthDeps = {
    userRepository: createUserRepository(),
    authSessionRepository: createAuthSessionRepository(),
    auditRepository: createAuditRepository(),
    accessTokenService: createAccessTokenService({
      issuer: "https://api.beonedge.test",
      audience: "boe-web",
      currentKid: "k1",
      signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
      verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
    }),
    database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rt1",
    csrfKeyVersion: "cs1",
    clock: () => new Date(),
    config: { cookieSecure: false, originAllowlist: [ORIGIN] },
  }
  const adminDeps: AdminIdentityDeps = {
    webAuth,
    unitOfWork,
    database,
    clock: () => new Date(),
    crypto,
    config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" },
    appUpdate: { releaseRoot: tmpdir(), downloadBaseUrl: "https://dev-app.beonedge.in/downloads" },
    applicationRepository: createApplicationRepository(),
    identityLockRepository: createIdentityLockRepository(),
    applicationReviewRepository: createApplicationReviewRepository(),
    userRepository: createUserRepository(),
    credentialRepository: createCredentialRepository(),
    outboxRepository,
    emailDeliveryRepository,
    auditRepository: createAuditRepository(),
    idempotencyRepository: createIdempotencyRepository(),
  }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerWebAuthRoutes(instance, { ...webAuth, unitOfWork, loginEventRepository: createLoginEventRepository() })
      registerAdminIdentityRoutes(instance, adminDeps)
    },
  })
  await createAdmin("onboarding@example.com")
}, 220_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("enqueueEmail on PostgreSQL", () => {
  test("writes the event, delivery and encrypted payload together and stores no plaintext anywhere", async () => {
    const queued = await queueSealed("enqueue")

    const payload = await payloadRow(queued)
    expect(await outboxRow(queued)).toMatchObject({ topic: SEALED_EMAIL_TOPIC, payload: { template: "account_approved" } })
    expect(await deliveryRow(queued)).toMatchObject({ template_key: "account_approved", template_version: "v1", state: "queued" })
    expectSealed(payload)
    expect(payload).toMatchObject({ key_version: "ek1" })
    expect((payload.nonce as Buffer).length).toBe(12)
    expect((payload.ciphertext as Buffer).includes(Buffer.from(SECRET))).toBe(false)
    expect(await rowsMentioning(SECRET)).toBe(0)
  })

  test("rolls the event, delivery and payload back together when the caller's transaction aborts", async () => {
    const count = async (): Promise<number[]> =>
      Promise.all(
        ["outbox_events", "email_deliveries", "email_delivery_payloads"].map(
          async (table) => (await pool.query<{ c: number }>(`select count(*)::int as c from ${table}`)).rows[0]?.c ?? -1,
        ),
      )
    const email = `abort-${randomUUID()}@example.com`
    const applicationId = (
      await pool.query<{ id: string }>(
        "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
          "values ($1, $2, 'Ada Lovelace', 'rejected', now(), now()) returning id",
        [email, nextPhone()],
      )
    ).rows[0]?.id
    if (applicationId === undefined) throw new Error("application not created")
    const before = await count()

    await expect(
      unitOfWork.execute(async (tx) => {
        await enqueueEmail(
          tx,
          { outboxRepository, emailDeliveryRepository, crypto },
          {
            recipient: email,
            template: { templateKey: "application_rejected", applicationId },
            templateVersion: "v1",
            sesConfigurationSet: "boe-transactional",
            eventType: "application.rejected",
            eventVersion: 1,
            aggregateType: "application",
            aggregateId: applicationId,
            requestId: randomUUID(),
            deduplicationKey: `application_rejected:${applicationId}`,
            payload: { template: "application_rejected" },
            sealedPayload: { downloadUrl: SECRET_URL },
          },
        )
        throw new Error("caller aborted")
      }),
    ).rejects.toThrow("caller aborted")

    expect(await count()).toEqual(before)
  })
})

describe("sealed payload at send time", () => {
  test("renders the decrypted link into the message body and leaves no copy in the database", async () => {
    const queued = await queueSealed("render")
    const sender = transport("accept")

    await dispatch(sender)

    const message = sender.messages.find((candidate) => candidate.to === queued.email)
    expect(message?.text).toContain(SECRET_URL)
    expect(message?.html).toContain(SECRET_URL)
    expect(message?.subject).not.toContain(SECRET)
    expect(await deliveryRow(queued)).toMatchObject({ state: "sent" })
    expectScrubbed(await payloadRow(queued))
    expect(await rowsMentioning(SECRET)).toBe(0)
  })

  test.each([
    ["corrupted ciphertext", "update email_delivery_payloads set ciphertext = set_byte(ciphertext, 0, get_byte(ciphertext, 0) # 255) where email_delivery_id = $1", "EMAIL_PAYLOAD_UNREADABLE"],
    ["another key version", "update email_delivery_payloads set key_version = 'ek0' where email_delivery_id = $1", "EMAIL_PAYLOAD_KEY_MISMATCH"],
    ["no payload row", "delete from email_delivery_payloads where email_delivery_id = $1", "EMAIL_PAYLOAD_MISSING"],
  ])("a payload with %s fails permanently with an explicit code and sends nothing", async (_name, damage, errorCode) => {
    const queued = await queueSealed("damaged")
    await pool.query(damage, [queued.deliveryId])
    const sender = transport("accept")

    await dispatch(sender)

    expect(sender.messages).toEqual([])
    expect(await deliveryRow(queued)).toMatchObject({ state: "permanent_failed", last_error_code: errorCode })
    expect(await outboxRow(queued)).toMatchObject({ state: "dead_lettered", last_error_code: errorCode })
    expect(await attemptRows(queued)).toMatchObject([{ generation: 1, outcome: "permanent", error_code: errorCode }])
    if (errorCode !== "EMAIL_PAYLOAD_MISSING") expectScrubbed(await payloadRow(queued))
  })

  test("a template version the renderer lacks fails permanently, sends nothing, scrubs the payload and keeps the recorded reference", async () => {
    const queued = await queueSealed("version", { templateVersion: "v9" })
    const sender = transport("accept")

    await dispatch(sender)

    expect(sender.messages).toEqual([])
    expect(await deliveryRow(queued)).toMatchObject({
      state: "permanent_failed",
      last_error_code: "TEMPLATE_VERSION_UNSUPPORTED",
      template_key: "account_approved",
      template_version: "v9",
    })
    expectScrubbed(await payloadRow(queued))
  })
})

describe("payload scrubbing on PostgreSQL", () => {
  const FINAL_STATES: readonly [string, (queued: Queued) => Promise<unknown>, string, string, string | null][] = [
    ["accepted by the transport", () => dispatch(transport("accept")), "sent", "delivered", "accepted"],
    ["refused permanently by the transport", () => dispatch(transport("refuse")), "permanent_failed", "dead_lettered", "permanent"],
    [
      "dead-lettered after the last retry",
      async (queued) => {
        await setAttemptCounts(queued, MAX_ATTEMPTS - 1)
        return dispatch(transport("time_out"))
      },
      "permanent_failed",
      "dead_lettered",
      "retryable",
    ],
    [
      "cancelled before sending",
      (queued) =>
        unitOfWork.execute((tx) => emailDeliveryRepository.cancel(tx, { deliveryId: queued.deliveryId, now: new Date() })),
      "cancelled",
      "pending",
      null,
    ],
    [
      "cancelled unsent with its outbox event",
      (queued) =>
        unitOfWork.execute((tx) =>
          outboxRepository.cancelUnsent(tx, { outboxEventId: queued.outboxId, generation: 0, now: new Date() }),
        ),
      "cancelled",
      "cancelled",
      null,
    ],
  ]

  test.each(FINAL_STATES)("a message %s loses its payload and keeps its attempt evidence", async (_name, act, deliveryState, outboxState, attemptOutcome) => {
    const queued = await queueSealed("final")
    expectSealed(await payloadRow(queued))

    await act(queued)

    expect(await deliveryRow(queued)).toMatchObject({ state: deliveryState, template_key: "account_approved", template_version: "v1" })
    expect(await outboxRow(queued)).toMatchObject({ state: outboxState })
    expectScrubbed(await payloadRow(queued))
    const attempts = await attemptRows(queued)
    if (attemptOutcome === null) expect(attempts).toEqual([])
    else expect(attempts).toMatchObject([{ generation: 1, worker_id: "worker-sealed", outcome: attemptOutcome }])
  })

  test("a retryable failure keeps the payload so the next attempt can still send it, then the payload is scrubbed", async () => {
    const queued = await queueSealed("retry")

    await dispatch(transport("time_out"))

    expect(await deliveryRow(queued)).toMatchObject({ state: "retryable_failed" })
    expect(await outboxRow(queued)).toMatchObject({ state: "retryable_failed" })
    expectSealed(await payloadRow(queued))

    const sender = transport("accept")
    await dispatch(sender, () => new Date(Date.now() + 24 * HOUR_MS))

    expect(sender.messages.find((message) => message.to === queued.email)?.text).toContain(SECRET_URL)
    expect(await deliveryRow(queued)).toMatchObject({ state: "sent" })
    expectScrubbed(await payloadRow(queued))
    expect(await attemptRows(queued)).toMatchObject([
      { generation: 1, outcome: "retryable" },
      { generation: 2, outcome: "accepted" },
    ])
  })

  test.each([
    ["a recovery that schedules a retry keeps the payload", 0, "retryable_failed", "retryable_failed", false],
    ["a recovery that dead-letters scrubs the payload", MAX_ATTEMPTS - 1, "permanent_failed", "dead_lettered", true],
  ])("%s", async (_name, priorAttempts, deliveryState, outboxState, scrubbed) => {
    const queued = await queueSealed("recover")
    await setAttemptCounts(queued, priorAttempts)
    const claimedAt = new Date()
    await unitOfWork.execute(async (tx) => {
      const claimed = await outboxRepository.claimDue(tx, {
        topics: [SEALED_EMAIL_TOPIC],
        workerId: "worker-crashed",
        leaseMs: 30_000,
        limit: 50,
        now: claimedAt,
      })
      expect(claimed.map((event) => event.id)).toContain(queued.outboxId)
      expect(await outboxRepository.markSending(tx, { outboxEventId: queued.outboxId, generation: 1, workerId: "worker-crashed", now: claimedAt })).toBe(true)
      await emailDeliveryRepository.transitionSending(tx, { deliveryId: queued.deliveryId, now: claimedAt })
    })

    const recovered = await recoverExpiredDeliveries({
      unitOfWork,
      outboxRepository,
      emailDeliveryRepository,
      clock: () => new Date(claimedAt.getTime() + HOUR_MS),
      batchLimit: 50,
    })

    expect(recovered).toBeGreaterThanOrEqual(1)
    expect(await deliveryRow(queued)).toMatchObject({ state: deliveryState })
    expect(await outboxRow(queued)).toMatchObject({ state: outboxState })
    if (scrubbed) expectScrubbed(await payloadRow(queued))
    else expectSealed(await payloadRow(queued))
    expect(await attemptRows(queued)).toMatchObject([{ generation: 1, worker_id: "worker-crashed", outcome: "unknown" }])
  })
})

describe("composed email worker", () => {
  test("claims sealed mail, decrypts it with its own keys and keeps the payload while the transport is unconfigured", async () => {
    const queued = await queueSealed("composed")
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" })
    const worker = composeEmailDispatchWorker({
      ...CRYPTO_ENV,
      DATABASE_URL: container.getConnectionUri(),
      ACCESS_TOKEN_ISSUER: "https://test.example",
      ACCESS_TOKEN_AUDIENCE: "boe-test",
      ACCESS_TOKEN_CURRENT_KID: "test-k1",
      ACCESS_TOKEN_SIGNING_KEY: pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      ACCESS_TOKEN_VERIFICATION_KEYS: JSON.stringify({
        "test-k1": pair.publicKey.export({ type: "spki", format: "pem" }) as string,
      }),
      REFRESH_HMAC_KEY: key(),
      REFRESH_KEY_VERSION: "rt1",
      CSRF_KEY_VERSION: "cs1",
      CURSOR_HMAC_KEY: key(),
      WEB_COOKIE_SECURE: "false",
      WEB_ORIGIN_ALLOWLIST: ORIGIN,
      AWS_REGION: "us-east-1",
      SNS_TOPIC_ARN: "arn:aws:sns:us-east-1:000000000000:test",
      SES_CONFIGURATION_SET: "test-set",
      PASSWORD_BREACH_CHECK_MODE: "bypass",
      NODE_ENV: "test",
    })
    try {
      await worker.runOnce()
    } finally {
      await worker.dispose()
    }

    expect(worker.transportConfigured).toBe(false)
    expect(await outboxRow(queued)).toMatchObject({ topic: SEALED_EMAIL_TOPIC, state: "retryable_failed" })
    expect(await deliveryRow(queued)).toMatchObject({ state: "retryable_failed", last_error_code: "EMAIL_TRANSPORT_NOT_CONFIGURED" })
    expect(await attemptRows(queued)).toMatchObject([
      { generation: 1, outcome: "retryable", error_code: "EMAIL_TRANSPORT_NOT_CONFIGURED" },
    ])
    expectSealed(await payloadRow(queued))
  })
})

describe("sealed payload through the admin API", () => {
  test("the delivery list and application detail show a sealed delivery with no secret and no ciphertext", async () => {
    const queued = await queueSealed("admin-list")
    const stored = await payloadRow(queued)
    const cookie = await adminCookie("onboarding@example.com")
    const encodings = [stored.ciphertext, stored.nonce].flatMap((bytes) => {
      const buffer = bytes as Buffer
      return [buffer.toString("hex"), buffer.toString("base64"), buffer.toString("base64url")]
    })

    const list = await app.inject({
      method: "GET",
      url: `/v1/admin/email-deliveries?limit=50&templateKey=account_approved&state=queued&applicationId=${queued.applicationId}`,
      headers: { origin: ORIGIN, cookie },
    })
    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/applications/${queued.applicationId}`,
      headers: { origin: ORIGIN, cookie },
    })

    expect(list.statusCode).toBe(200)
    expect(detail.statusCode).toBe(200)
    const listed = dataOf<{ items: Row[] }>(list).items.find((item) => item.emailDeliveryId === queued.deliveryId)
    const embedded = dataOf<{ deliveries: { items: Row[] } }>(detail).deliveries.items.find(
      (item) => item.emailDeliveryId === queued.deliveryId,
    )
    expect(listed).toMatchObject({ templateKey: "account_approved", state: "queued", templateVersion: "v1" })
    expect(embedded).toMatchObject({ templateKey: "account_approved", state: "queued" })
    for (const body of [list.body, detail.body]) {
      expect(body).not.toContain(SECRET)
      for (const encoding of encodings) expect(body).not.toContain(encoding)
    }
    for (const item of [listed, embedded]) {
      expect(Object.keys(item ?? {}).filter((name) => /payload|cipher|nonce|key_?version/iu.test(name))).toEqual([])
    }
  })
})
