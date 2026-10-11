import { randomBytes } from "node:crypto"
import { describe, expect, test, vi } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../crypto/context.js"
import type { KeyedEnvelope } from "../../crypto/context.js"
import type { UnitOfWork } from "../../db/database.js"
import type { EmailDelivery, EmailDeliveryPayload, EmailSuppression, OutboxEvent, Transaction } from "../../db/repositories.js"
import type { SesEmailSender, SesSendRequest } from "../../email/ports.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import { dispatchDueDeliveries } from "./dispatchDueDeliveries.js"

const key = (): string => randomBytes(32).toString("base64")

const crypto = createCryptoContext(
  parseCryptoKeys({
    CRYPTO_TOKEN_HASH_KEY: key(),
    CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
    CRYPTO_CONSENT_IP_HMAC_KEY: key(),
    CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
    CRYPTO_RECIPIENT_HMAC_KEY: key(),
    CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
    CRYPTO_RECIPIENT_ENC_KEY: key(),
    CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
  }),
)

const T0 = new Date("2026-03-01T10:00:00.000Z")
const DELIVERY_ID = "delivery-1"
const SECRET = "secret-token-9f2c"
const SECRET_URL = `https://downloads.test/${SECRET}/boe.apk`
const SEALED_TOPIC = "email.sealed"
const transaction = {} as unknown as Transaction
const unitOfWork: UnitOfWork = { execute: (operation) => operation(transaction) }

const outboxEvent = (topic: string): OutboxEvent => ({
  id: "outbox-1",
  topic,
  event_type: "user.account_approved",
  event_version: 1,
  aggregate_type: "user",
  aggregate_id: "aggregate-1",
  occurred_at: T0,
  request_id: "request-1",
  causation_id: null,
  correlation_id: null,
  deduplication_key: "dedup-1",
  payload: { template: "account_approved" },
  state: "processing",
  attempt_count: 0,
  lease_generation: 1,
  available_at: T0,
  locked_at: T0,
  locked_by: "worker-1",
  lease_expires_at: new Date(T0.getTime() + 60_000),
  delivered_at: null,
  cancelled_at: null,
  last_error_code: null,
  created_at: T0,
  updated_at: T0,
})

const deliveryRow = (): EmailDelivery => {
  const envelope = crypto.encryptRecipient("learner@example.com")
  return {
    id: DELIVERY_ID,
    outbox_event_id: "outbox-1",
    application_id: "application-1",
    user_id: null,
    template_key: "account_approved",
    template_version: "v1",
    recipient_ciphertext: envelope.ciphertext,
    recipient_nonce: envelope.nonce,
    recipient_hmac: crypto.hmacRecipient("learner@example.com").hash,
    recipient_masked: "l***@example.com",
    recipient_encryption_key_version: envelope.keyVersion,
    suppression_hmac_key_version: crypto.suppressionHmacKeyVersion,
    ses_configuration_set: "boe-transactional",
    ses_message_id: null,
    ses_request_id: null,
    state: "queued",
    attempt_count: 0,
    last_attempt_at: null,
    last_error_code: null,
    failure_detail_ciphertext: null,
    failure_detail_nonce: null,
    failure_detail_key_version: null,
    sent_at: null,
    delivered_at: null,
    bounced_at: null,
    complained_at: null,
    cancelled_at: null,
    erased_at: null,
    created_at: T0,
    updated_at: T0,
    version: "1",
  }
}

const sealedRow = (overrides: Partial<EmailDeliveryPayload> = {}, deliveryId = DELIVERY_ID): EmailDeliveryPayload => {
  const sealed = crypto.encryptDeliveryPayload(deliveryId, { downloadUrl: SECRET_URL })
  return {
    email_delivery_id: DELIVERY_ID,
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    key_version: sealed.keyVersion,
    created_at: T0,
    scrubbed_at: null,
    ...overrides,
  }
}

interface Scenario {
  readonly topic: string
  readonly started?: boolean
  readonly suppressed?: boolean
  readonly stored?: EmailDeliveryPayload | null
}

const run = async (scenario: Scenario) => {
  const order: string[] = []
  const sent: SesSendRequest[] = []
  const event = outboxEvent(scenario.topic)
  const decrypt = vi.fn((deliveryId: string, envelope: KeyedEnvelope) => {
    order.push("decrypt")
    return crypto.decryptDeliveryPayload(deliveryId, envelope)
  })
  const sender: SesEmailSender = {
    send: (request) => {
      order.push("send")
      sent.push(request)
      return Promise.resolve({ outcome: "accepted", sesMessageId: "msg-1", sesRequestId: null })
    },
  }
  const outboxRepository: OutboxWriteRepository = {
    enqueue: vi.fn(),
    claimDue: vi.fn().mockResolvedValueOnce([event]).mockResolvedValue([]),
    markSending: vi.fn(() => {
      order.push("markSending")
      return Promise.resolve(scenario.started ?? true)
    }),
    settleDelivered: vi.fn(() => Promise.resolve(true)),
    scheduleRetry: vi.fn(() => Promise.resolve(true)),
    deadLetter: vi.fn(() => Promise.resolve(true)),
    cancel: vi.fn(() => Promise.resolve(true)),
    release: vi.fn(() => Promise.resolve(true)),
    cancelUnsent: vi.fn(),
    recordAttemptResult: vi.fn(() => Promise.resolve()),
    recoverExpiredProcessing: vi.fn(() => Promise.resolve(0)),
    findExpiredSending: vi.fn(() => Promise.resolve([])),
    recoverUnknownSending: vi.fn(),
  }
  const emailDeliveryRepository: EmailDeliveryWriteRepository = {
    createAccountApprovedDelivery: vi.fn(),
    createRejectionDelivery: vi.fn(),
    insertSealedPayload: vi.fn(),
    findSealedPayload: vi.fn(() => {
      order.push("findSealedPayload")
      return Promise.resolve(scenario.stored ?? null)
    }),
    adminList: vi.fn(),
    listByApplication: vi.fn(),
    lockByOutboxEventId: vi.fn(() => Promise.resolve(deliveryRow())),
    lockById: vi.fn(),
    lockBySesMessageId: vi.fn(),
    transitionSending: vi.fn(() => Promise.resolve()),
    recordSent: vi.fn(() => Promise.resolve()),
    recordSendFailure: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    applyEvidence: vi.fn(),
  }
  const summary = await dispatchDueDeliveries({
    unitOfWork,
    outboxRepository,
    emailDeliveryRepository,
    emailSuppressionRepository: {
      findActive: vi.fn(() => Promise.resolve(scenario.suppressed === true ? ({} as EmailSuppression) : null)),
      suppress: vi.fn(),
    },
    sender,
    crypto: { ...crypto, decryptDeliveryPayload: decrypt },
    clock: () => T0,
    config: {
      topics: ["email", SEALED_TOPIC],
      workerId: "worker-1",
      leaseMs: 60_000,
      claimLimit: 5,
      messageBudgetMs: 25_000,
      passBudgetMs: 35_000,
    },
  })
  return { summary, order, sent, decrypt, event, outboxRepository, emailDeliveryRepository }
}

const callsOf = (repository: object): unknown[] =>
  Object.values(repository).flatMap((member: unknown) => (vi.isMockFunction(member) ? member.mock.calls : []))

describe("dispatchDueDeliveries sealed payloads", () => {
  test("a claim lost before sending never reads the sidecar, decrypts or sends", async () => {
    const result = await run({ topic: SEALED_TOPIC, started: false, stored: sealedRow() })

    expect(result.summary).toMatchObject({ claimed: 1, superseded: 1, sent: 0 })
    expect(result.order).toEqual(["markSending"])
    expect(result.decrypt).not.toHaveBeenCalled()
    expect(result.sent).toEqual([])
  })

  test("work that is suppressed is cancelled without reading the sidecar or decrypting", async () => {
    const result = await run({ topic: SEALED_TOPIC, suppressed: true, stored: sealedRow() })

    expect(result.summary).toMatchObject({ cancelled: 1, sent: 0 })
    expect(result.order).toEqual([])
    expect(result.decrypt).not.toHaveBeenCalled()
  })

  test("decrypts only once the fenced claim holds and hands the plaintext to the sender and nowhere else", async () => {
    const result = await run({ topic: SEALED_TOPIC, stored: sealedRow() })

    expect(result.summary).toMatchObject({ claimed: 1, sent: 1 })
    expect(result.order).toEqual(["markSending", "findSealedPayload", "decrypt", "send"])
    expect(result.decrypt).toHaveBeenCalledWith(DELIVERY_ID, expect.objectContaining({ keyVersion: "ek1" }))
    expect(result.sent[0]?.templateData).toEqual({ template: "account_approved", downloadUrl: SECRET_URL })
    expect(result.event.payload).toEqual({ template: "account_approved" })
    expect(JSON.stringify([callsOf(result.outboxRepository), callsOf(result.emailDeliveryRepository)])).not.toContain(SECRET)
  })

  test.each([
    ["has no sidecar row", () => null, "EMAIL_PAYLOAD_MISSING"],
    ["was already scrubbed", () => sealedRow({ ciphertext: null, nonce: null, scrubbed_at: T0 }), "EMAIL_PAYLOAD_MISSING"],
    ["was sealed under another key version", () => sealedRow({ key_version: "ek0" }), "EMAIL_PAYLOAD_KEY_MISMATCH"],
    [
      "was tampered with",
      () => {
        const row = sealedRow()
        const tampered = Buffer.from(row.ciphertext ?? Buffer.alloc(0))
        tampered[0] = (tampered[0] ?? 0) ^ 0xff
        return { ...row, ciphertext: tampered }
      },
      "EMAIL_PAYLOAD_UNREADABLE",
    ],
    ["was sealed for another delivery", () => sealedRow({}, "delivery-2"), "EMAIL_PAYLOAD_UNREADABLE"],
  ])("a payload that %s fails permanently with its own code and sends nothing", async (_name, stored, errorCode) => {
    const result = await run({ topic: SEALED_TOPIC, stored: stored() })

    expect(result.summary).toMatchObject({ claimed: 1, deadLettered: 1, retried: 0, sent: 0 })
    expect(result.sent).toEqual([])
    expect(result.outboxRepository.scheduleRetry).not.toHaveBeenCalled()
    expect(result.outboxRepository.deadLetter).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ outboxEventId: "outbox-1", generation: 1, errorCode }),
    )
    expect(result.emailDeliveryRepository.recordSendFailure).toHaveBeenCalledWith(transaction, {
      deliveryId: DELIVERY_ID,
      errorCode,
      permanent: true,
      now: T0,
    })
    expect(result.outboxRepository.recordAttemptResult).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ outcome: "permanent", errorCode }),
    )
  })

  test("a message on the plain topic never touches the sidecar", async () => {
    const result = await run({ topic: "email", stored: sealedRow() })

    expect(result.order).toEqual(["markSending", "send"])
    expect(result.decrypt).not.toHaveBeenCalled()
    expect(result.sent[0]?.templateData).toEqual({ template: "account_approved" })
  })
})
