import { createSign, randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import type { CryptoContext } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import type { UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { dispatchDueDeliveries } from "../../src/domain/email/dispatchDueDeliveries.js"
import { submitApplication } from "../../src/domain/onboarding/submitApplication.js"
import type { SesEmailSender, SesSendResult } from "../../src/email/ports.js"
import { createTransactionalEmailSender } from "../../src/email/transactionalEmailSender.js"
import { buildCanonicalMessage } from "../../src/email/snsProvenance.js"
import { parseSnsEnvelope } from "../../src/email/snsMessages.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createConsentRepository } from "../../src/repositories/consentRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createEmailProviderEventRepository } from "../../src/repositories/emailProviderEventRepository.js"
import { createEmailSuppressionRepository } from "../../src/repositories/emailSuppressionRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createVerificationTokenRepository } from "../../src/repositories/verificationTokenRepository.js"
import { registerProviderEventRoutes } from "../../src/routes/providerEventRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

// Static self-signed RSA fixture (valid 2026-07-20 .. 2036), matched to FIXED_NOW.
const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDFDCCAfygAwIBAgIJawIxHeB8Z80nMA0GCSqGSIb3DQEBCwUAMCYxJDAiBgNV
BAMTG3Nucy51cy1lYXN0LTEuYW1hem9uYXdzLmNvbTAeFw0yNjA3MjAxNzUyMzJa
Fw0zNjA3MTcxNzUyMzJaMCYxJDAiBgNVBAMTG3Nucy51cy1lYXN0LTEuYW1hem9u
YXdzLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK9XwaEP7yVi
bRdZSI1qPsovbJCAz0W4HgWDRih/a4W/12bT3t3H1sFDKoTRzyHOmkNx8UpZin1o
ZPzKlxlSGknllcRYDawz7Sc+MThfp90YXn1CXsMa8vHJ1IxwnEeX1ggLQQ8UZmhX
e78qBmhSZ7WXr7l+E4H9Y4gmdMQVCSAIGdJEEUDipMpyVVUDVBEdmy450f0Zemz4
yYSC+K9qzw3A/SPNj/0nIIyaY29WNdehfGpf7Oqse1J4qq7M7bgqb1TuM9npPAmH
o/U3vQpglS2YH/DQyPXqzMmkZ4rKTz+ICgl0QaEKz1CQdhFon9hrVEG1M6enaSQb
GdX1Gr5zLnMCAwEAAaNFMEMwDAYDVR0TBAUwAwEB/zALBgNVHQ8EBAMCAvQwJgYD
VR0RBB8wHYYbaHR0cDovL2V4YW1wbGUub3JnL3dlYmlkI21lMA0GCSqGSIb3DQEB
CwUAA4IBAQBGcLbgEUjtdMzzCEMhrzPEaS/cK/BMjiAFDIXRMfQIPjy6tSj+XP5x
lQ4v/mLvMSVhZJRo7ZXfLi2rZouqO0AkpbBdIiUdYFOvRsYEomBI56TgLkMiN49/
3doxotkzoFqojAER4eAaNhSzpH7YJawtlsonMLxia25IawNNKY3U+5oVu/lzgXyq
kfV7B/fm7WWjI6rtXu0jOyWSISsJzorm2BXZcO2rZS5nKgW9i60CJqAmr/yjUNJo
GpM29OjEpTqC3o8b8RovEkgMU4w/2vDNJHEp8pSc3G8WFOAXsySa9EKsIQZYmUNf
/tB1YK4REgDliABBDUKjblAwx20HYMvE
-----END CERTIFICATE-----
`

const KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAr1fBoQ/vJWJtF1lIjWo+yi9skIDPRbgeBYNGKH9rhb/XZtPe
3cfWwUMqhNHPIc6aQ3HxSlmKfWhk/MqXGVIaSeWVxFgNrDPtJz4xOF+n3RhefUJe
wxry8cnUjHCcR5fWCAtBDxRmaFd7vyoGaFJntZevuX4Tgf1jiCZ0xBUJIAgZ0kQR
QOKkynJVVQNUER2bLjnR/Rl6bPjJhIL4r2rPDcD9I82P/ScgjJpjb1Y116F8al/s
6qx7UniqrsztuCpvVO4z2ek8CYej9Te9CmCVLZgf8NDI9erMyaRnispPP4gKCXRB
oQrPUJB2EWif2GtUQbUzp6dpJBsZ1fUavnMucwIDAQABAoIBADuEGQg3ZWAWIZtM
RfEiP//Wyw3dev1aOm56mYTDg1aZwF55yesTmtRsnPEKWjlKbFg6Q8GN1REuLyET
DuicUqoEkKpdjP6HfZbVaFWPOmY0kFYKAipNamshq9CjpJg0dIS0dTfOH9iI4UsI
07XzSpp7yzy2C58SyAb9rqKj1T4WkVIYmi/9HM+vQts6tNgEPxNd3mB0JjR0a0wF
3k86F1tyeodFyAKIGN0NVzoGAuemdpgkqEoW8MCRIKbSvCYaYfd5thHWmYv6ru2D
noGcBH3n2b+s3aiBLkfL6m4DcI0+DCuVhUO9vRzZ08oEjxgN0DBVZCEvQSbuaEe+
vIAf0GECgYEA6YuhheMEFEj6BzX4W08jzyLVTKKEBzKwFAUNb0TA0Je7MB3yQhaW
yJi4UmjALYolJRfegkjirxSIdBCWDdaC0dvAjNXBDSynSkz9N98UJLi43cgTzc8s
677nMBhCVRq3DtwGaWX5kFsnFCjYBgtkY2aijU0o1vMDTNYHXec9CCMCgYEAwDOO
Ixh1wAORwU0df8N+aqHLROSGzdkLRQAG4a743U+q7q/uzrVXjrrhbis/m00FaZoS
ePN7fH7qP+Tqk1G6HpjXUrZakrOJR7yRnTIVGFyzcG11R/bek4vEUIZK0ObuCN1t
d3SKD4ywDAZGZ/abeXTZrcrs1ruEyuRX4vIo/XECgYAfkdNswMo9X7wEm4QN+72w
c1n3+QP14SEyI5i0UMvrpocUMwgbbOhHB3XrFePchA8PW5GldOrHlfP4FIHkLvoS
Gi2GHCLzf/TBM3ULR2l2qU28FR6wNHAzEeQ4eR8GWA0kwhNPzgwVOm0m6XqCHqoc
UbRpe2Oo4sKwcUIfrHFwlwKBgBhmcyUBdfFqgpaHs7cEmofvAl88o+B+LXAVEMqV
7AIsmwayTx7u5q64CuZxlyGgJY/Cf5XbU1H6ysJRzXXmajp4LN3TSKxXHpZ82f+a
3BK7sgwT2U/Jh3gzxjhy1AyxRIbblYoUwXI36iGcqlOIezRwITJvEKIyLCmV05J8
K7gBAoGAUs8wNdasgFIWxljK1PqjLikDrwSmb+PVYS0ysJQH4u4WslgjsXJtWXPX
jef5u2ANNCcRcqupezIm7UzoTQI+x+VEA8z4BVcpVWZ7jeEGl2kGPHpm5oDCXlOa
jw+0IzR0akwb1JMKvEQnDTHwETx5HxD5GpLzLjwFU0hwR8/R5Qs=
-----END RSA PRIVATE KEY-----
`

const REGION = "us-east-1"
const TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:boe-ses"
const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem"
const FIXED_NOW = new Date("2026-08-01T00:00:00.000Z")

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let crypto: CryptoContext
let unitOfWork: UnitOfWork

const outboxRepository = createOutboxRepository()
const emailDeliveryRepository = createEmailDeliveryRepository()
const emailProviderEventRepository = createEmailProviderEventRepository()
const emailSuppressionRepository = createEmailSuppressionRepository()
const key = (bytes: number): string => randomBytes(bytes).toString("base64")

interface SeededDelivery {
  readonly deliveryId: string
  readonly outboxId: string
  readonly email: string
}

const seedQueuedDelivery = async (email: string, phone: string): Promise<SeededDelivery> => {
  await unitOfWork.execute((tx) =>
    submitApplication(
      tx,
      {
        applicationRepository: createApplicationRepository(),
        consentRepository: createConsentRepository(),
        verificationTokenRepository: createVerificationTokenRepository(),
        emailDeliveryRepository,
        outboxRepository,
        auditRepository: createAuditRepository(),
        crypto,
        clock: () => new Date(),
        config: {
          verificationTokenTtlMs: 86_400_000,
          sesConfigurationSet: "boe-transactional",
          verificationResendCooldownMs: 15 * 60 * 1000,
        },
      },
      {
        fullName: "Ada Lovelace",
        emailNormalized: email,
        phoneE164: phone,
        // This test is about the delivery row, not the credential; a signup with
        // no password still produces the verification email being asserted here.
        passwordHash: null,
        consents: [
          { kind: "terms", version: "v1" },
          { kind: "privacy", version: "v1" },
        ],
        requestId: randomUUID(),
        clientIp: "203.0.113.5",
        userAgent: "integration-test",
      },
    ),
  )

  const row = (
    await pool.query<{ delivery_id: string; outbox_id: string }>(
      "select ed.id as delivery_id, ed.outbox_event_id as outbox_id from email_deliveries ed " +
        "join applications a on a.id = ed.application_id where a.email_normalized = $1",
      [email],
    )
  ).rows[0]
  if (row === undefined) throw new Error("seed delivery not found")
  return { deliveryId: row.delivery_id, outboxId: row.outbox_id, email }
}

const acceptingSender = (sesMessageId: string): SesEmailSender => ({
  send: () => Promise.resolve<SesSendResult>({ outcome: "accepted", sesMessageId, sesRequestId: "req-1" }),
})

const workerDeps = (sender: SesEmailSender) => ({
  unitOfWork,
  outboxRepository,
  emailDeliveryRepository,
  emailSuppressionRepository,
  sender,
  crypto,
  clock: () => new Date(),
  config: { topic: "email", workerId: "worker-1", leaseMs: 30_000, claimLimit: 10 },
})

const deliveryState = async (deliveryId: string): Promise<Record<string, unknown>> =>
  (
    await pool.query(
      "select state, attempt_count, ses_message_id, sent_at, delivered_at, complained_at from email_deliveries where id = $1",
      [deliveryId],
    )
  ).rows[0] as Record<string, unknown>

const outboxState = async (outboxId: string): Promise<Record<string, unknown>> =>
  (
    await pool.query("select state, attempt_count, available_at, locked_at from outbox_events where id = $1", [outboxId])
  ).rows[0] as Record<string, unknown>

const signedNotification = (message: string): string => {
  const draft = {
    Type: "Notification",
    MessageId: randomUUID(),
    TopicArn: TOPIC_ARN,
    Message: message,
    Timestamp: FIXED_NOW.toISOString(),
    SignatureVersion: "2",
    Signature: "placeholder",
    SigningCertURL: CERT_URL,
  }
  const envelope = parseSnsEnvelope(draft)
  if (envelope === null) throw new Error("test envelope failed to parse")
  const signer = createSign("RSA-SHA256")
  signer.update(buildCanonicalMessage(envelope), "utf8")
  signer.end()
  return JSON.stringify({ ...draft, Signature: signer.sign(KEY_PEM, "base64") })
}

const postSns = (body: string): Promise<{ statusCode: number }> =>
  app.inject({ method: "POST", url: "/v1/provider-events/aws-sns", headers: { "content-type": "text/plain" }, payload: body })

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
  unitOfWork = createUnitOfWork(database)
  crypto = createCryptoContext(
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
      registerProviderEventRoutes(instance, {
        unitOfWork,
        clock: () => FIXED_NOW,
        certificateFetcher: { fetch: () => Promise.resolve({ pem: CERT_PEM }) },
        config: { awsRegion: REGION, topicArn: TOPIC_ARN, providerEventTtlMs: 7 * 86_400_000 },
        emailProviderEventRepository,
        emailDeliveryRepository,
        emailSuppressionRepository,
      })
    },
  })
}, 220_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("email delivery worker (integration)", () => {
  test("sends a queued delivery and settles both rows on SES acceptance", async () => {
    const seeded = await seedQueuedDelivery("worker-ok@example.com", "+14155559001")
    const summary = await dispatchDueDeliveries(workerDeps(acceptingSender("ses-ok-1")))

    expect(summary.sent).toBe(1)
    const delivery = await deliveryState(seeded.deliveryId)
    expect(delivery.state).toBe("sent")
    expect(delivery.ses_message_id).toBe("ses-ok-1")
    expect(delivery.sent_at).not.toBeNull()
    const outbox = await outboxState(seeded.outboxId)
    expect(outbox.state).toBe("delivered")
    expect(outbox.locked_at).toBeNull()
  })

  test("the transport adapter renders a usable verification email end to end", async () => {
    // Exercises the concrete sender the deploy stack uses, not a stub: the token in
    // the queued payload has to reach the body, or the recipient cannot continue.
    const seeded = await seedQueuedDelivery("worker-render@example.com", "+14155559021")
    const token = (
      await pool.query<{ token: string }>(
        "select payload->>'verificationToken' as token from outbox_events where id = $1",
        [seeded.outboxId],
      )
    ).rows[0]?.token
    expect(token).toBeTruthy()

    const sent: { to: string; subject: string; text: string }[] = []
    const adapter = createTransactionalEmailSender({
      sender: {
        send: (message) => {
          sent.push({ to: message.to, subject: message.subject, text: message.text })
          return Promise.resolve({ messageId: "<render-1@mailbox>" })
        },
      },
      templates: {
        landingOrigin: "https://beonedge.example",
        activationUrl: null,
        supportAddress: "support@beonedge.example",
      },
    })

    const summary = await dispatchDueDeliveries(workerDeps(adapter))

    expect(summary.sent).toBe(1)
    expect(sent).toHaveLength(1)
    // The recipient is decrypted from the delivery row, and the link is complete.
    expect(sent[0]?.to).toBe("worker-render@example.com")
    expect(sent[0]?.text).toContain(`https://beonedge.example/verify-email?token=${token ?? ""}`)
    const delivery = await deliveryState(seeded.deliveryId)
    expect(delivery.state).toBe("sent")
    expect(delivery.ses_message_id).toBe("<render-1@mailbox>")
  })

  test("a delivery whose payload lost its token dead-letters instead of sending", async () => {
    const seeded = await seedQueuedDelivery("worker-notoken@example.com", "+14155559022")
    await pool.query("update outbox_events set payload = '{\"template\":\"verify_email\"}'::jsonb where id = $1", [
      seeded.outboxId,
    ])

    const send = vi.fn()
    const summary = await dispatchDueDeliveries(
      workerDeps(
        createTransactionalEmailSender({
          sender: { send },
          templates: { landingOrigin: null, activationUrl: null, supportAddress: null },
        }),
      ),
    )

    expect(summary.deadLettered).toBe(1)
    expect(send).not.toHaveBeenCalled()
    expect((await outboxState(seeded.outboxId)).state).toBe("dead_lettered")
  })

  test("reschedules a retryable SES failure with an incremented attempt", async () => {
    const seeded = await seedQueuedDelivery("worker-retry@example.com", "+14155559002")
    const retryable: SesEmailSender = {
      send: () => Promise.resolve<SesSendResult>({ outcome: "rejected", disposition: "retryable", errorCode: "SES_THROTTLED" }),
    }
    const summary = await dispatchDueDeliveries(workerDeps(retryable))

    expect(summary.retried).toBe(1)
    const delivery = await deliveryState(seeded.deliveryId)
    expect(delivery.state).toBe("retryable_failed")
    expect(delivery.attempt_count).toBe(1)
    const outbox = await outboxState(seeded.outboxId)
    expect(outbox.state).toBe("retryable_failed")
    expect(outbox.attempt_count).toBe(1)
    expect(new Date(outbox.available_at as string).getTime()).toBeGreaterThan(Date.now())
  })

  test("cancels both rows for a suppressed recipient without calling SES", async () => {
    const seeded = await seedQueuedDelivery("worker-suppressed@example.com", "+14155559003")
    const recipientHmac = crypto.hmacRecipient("worker-suppressed@example.com").hash
    const sourceEvent = (
      await pool.query<{ id: string }>(
        "insert into email_provider_events (sns_message_id, sns_topic_arn, sns_type, payload_sha256, expires_at) " +
          "values ($1, $2, 'Notification', $3, now() + interval '7 days') returning id",
        [randomUUID(), TOPIC_ARN, Buffer.alloc(32)],
      )
    ).rows[0]
    await pool.query(
      "insert into email_suppressions (recipient_hmac, suppression_hmac_key_version, reason, source_event_id) " +
        "values ($1, $2, 'complaint', $3)",
      [recipientHmac, crypto.suppressionHmacKeyVersion, sourceEvent?.id],
    )

    let sent = false
    const guardSender: SesEmailSender = {
      send: () => {
        sent = true
        return Promise.resolve<SesSendResult>({ outcome: "accepted", sesMessageId: "should-not-happen", sesRequestId: null })
      },
    }
    const summary = await dispatchDueDeliveries(workerDeps(guardSender))

    expect(sent).toBe(false)
    expect(summary.cancelled).toBe(1)
    expect((await deliveryState(seeded.deliveryId)).state).toBe("cancelled")
    expect((await outboxState(seeded.outboxId)).state).toBe("cancelled")
  })

  test("dead-letters after the eighth attempt", async () => {
    const seeded = await seedQueuedDelivery("worker-dead@example.com", "+14155559004")
    await pool.query("update outbox_events set attempt_count = 7 where id = $1", [seeded.outboxId])
    await pool.query("update email_deliveries set attempt_count = 7 where id = $1", [seeded.deliveryId])

    const retryable: SesEmailSender = {
      send: () => Promise.resolve<SesSendResult>({ outcome: "rejected", disposition: "retryable", errorCode: "SES_5XX" }),
    }
    const summary = await dispatchDueDeliveries(workerDeps(retryable))

    expect(summary.deadLettered).toBe(1)
    expect((await deliveryState(seeded.deliveryId)).state).toBe("permanent_failed")
    expect((await outboxState(seeded.outboxId)).state).toBe("dead_lettered")
  })
})

describe("POST /v1/provider-events/aws-sns (integration)", () => {
  test("records a Delivery notification and marks the delivery delivered", async () => {
    const seeded = await seedQueuedDelivery("sns-delivery@example.com", "+14155559010")
    await dispatchDueDeliveries(workerDeps(acceptingSender("ses-sns-1")))

    const body = signedNotification(
      JSON.stringify({
        eventType: "Delivery",
        mail: { messageId: "ses-sns-1", tags: { boe_delivery_id: [seeded.deliveryId] } },
      }),
    )
    const response = await postSns(body)

    expect(response.statusCode).toBe(200)
    const delivery = await deliveryState(seeded.deliveryId)
    expect(delivery.state).toBe("delivered")
    expect(delivery.delivered_at).not.toBeNull()
  })

  test("rejects an invalid signature with 401", async () => {
    const good = signedNotification(JSON.stringify({ eventType: "Delivery", mail: { messageId: "x" } }))
    const tampered = JSON.stringify({ ...JSON.parse(good), Signature: Buffer.from("nope").toString("base64") })
    const response = await postSns(tampered)
    expect(response.statusCode).toBe(401)
  })

  test("treats a duplicate MessageId as a 200 no-op", async () => {
    const body = signedNotification(JSON.stringify({ eventType: "Delivery", mail: { messageId: "dup-1" } }))
    const first = await postSns(body)
    const second = await postSns(body)
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)

    const messageId = (JSON.parse(body) as { MessageId: string }).MessageId
    const count = (
      await pool.query<{ c: number }>(
        "select count(*)::int as c from email_provider_events where sns_message_id = $1",
        [messageId],
      )
    ).rows[0]?.c
    expect(count).toBe(1)
  })

  test("creates a suppression from a Complaint notification", async () => {
    const seeded = await seedQueuedDelivery("sns-complaint@example.com", "+14155559011")
    await dispatchDueDeliveries(workerDeps(acceptingSender("ses-sns-2")))

    const body = signedNotification(
      JSON.stringify({
        eventType: "Complaint",
        mail: { messageId: "ses-sns-2", tags: { boe_delivery_id: [seeded.deliveryId] } },
      }),
    )
    const response = await postSns(body)
    expect(response.statusCode).toBe(200)

    const recipientHmac = crypto.hmacRecipient("sns-complaint@example.com").hash
    const suppressed = (
      await pool.query<{ c: number }>(
        "select count(*)::int as c from email_suppressions where recipient_hmac = $1",
        [recipientHmac],
      )
    ).rows[0]?.c
    expect(suppressed).toBe(1)
  })
})
