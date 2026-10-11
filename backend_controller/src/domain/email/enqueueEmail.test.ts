import { randomBytes } from "node:crypto"
import { describe, expect, test, vi } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../crypto/context.js"
import type { EmailDelivery, OutboxEvent, Transaction } from "../../db/repositories.js"
import type {
  CreateAccountApprovedDeliveryInput,
  CreateRejectionDeliveryInput,
  EmailDeliveryWriteRepository,
  InsertSealedPayloadInput,
} from "../../repositories/emailDeliveryRepository.js"
import type { EnqueueOutboxInput, OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import { enqueueEmail, type EnqueueEmailDeps, type EnqueueEmailInput } from "./enqueueEmail.js"

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

const tx = {} as unknown as Transaction
const SECRET = "secret-token-9f2c"
const RECIPIENT = "learner@example.com"
const APPLICATION_ID = "11111111-1111-4111-8111-111111111111"
const USER_ID = "22222222-2222-4222-8222-222222222222"

const build = () => {
  const enqueue = vi.fn<(tx: Transaction, input: EnqueueOutboxInput) => Promise<OutboxEvent>>(() =>
    Promise.resolve({ id: "outbox-1" } as unknown as OutboxEvent),
  )
  const createAccountApprovedDelivery = vi.fn<
    (tx: Transaction, input: CreateAccountApprovedDeliveryInput) => Promise<EmailDelivery>
  >(() => Promise.resolve({ id: "delivery-1" } as unknown as EmailDelivery))
  const createRejectionDelivery = vi.fn<
    (tx: Transaction, input: CreateRejectionDeliveryInput) => Promise<EmailDelivery>
  >(() => Promise.resolve({ id: "delivery-1" } as unknown as EmailDelivery))
  const insertSealedPayload = vi.fn<(tx: Transaction, input: InsertSealedPayloadInput) => Promise<void>>(() =>
    Promise.resolve(),
  )
  const deps: EnqueueEmailDeps = {
    outboxRepository: { enqueue } as unknown as OutboxWriteRepository,
    emailDeliveryRepository: {
      createAccountApprovedDelivery,
      createRejectionDelivery,
      insertSealedPayload,
    } as unknown as EmailDeliveryWriteRepository,
    crypto,
  }
  return { deps, enqueue, createAccountApprovedDelivery, createRejectionDelivery, insertSealedPayload }
}

const APPROVAL: EnqueueEmailInput = {
  recipient: RECIPIENT,
  template: { templateKey: "account_approved", userId: USER_ID, applicationId: APPLICATION_ID },
  templateVersion: "v1",
  sesConfigurationSet: "boe-transactional",
  eventType: "user.account_approved",
  eventVersion: 1,
  aggregateType: "user",
  aggregateId: USER_ID,
  requestId: "33333333-3333-4333-8333-333333333333",
  deduplicationKey: `account_approved:${USER_ID}`,
  payload: { template: "account_approved" },
}

describe("enqueueEmail", () => {
  test("a sealed payload is stored encrypted under the delivery id and appears in no other write", async () => {
    const { deps, enqueue, createAccountApprovedDelivery, insertSealedPayload } = build()

    await enqueueEmail(tx, deps, { ...APPROVAL, sealedPayload: { downloadUrl: `https://downloads.test/${SECRET}/boe.apk` } })

    const stored = insertSealedPayload.mock.calls[0]?.[1]
    if (stored === undefined) throw new Error("expected the sealed payload to be inserted")
    expect(enqueue.mock.calls[0]?.[1].topic).toBe("email.sealed")
    expect(JSON.stringify([enqueue.mock.calls, createAccountApprovedDelivery.mock.calls])).not.toContain(SECRET)
    expect(stored.deliveryId).toBe("delivery-1")
    expect(stored.ciphertext.includes(Buffer.from(SECRET))).toBe(false)
    expect(
      crypto.decryptDeliveryPayload("delivery-1", {
        ciphertext: stored.ciphertext,
        nonce: stored.nonce,
        keyVersion: stored.keyVersion,
      }),
    ).toEqual({ kind: "opened", payload: { downloadUrl: `https://downloads.test/${SECRET}/boe.apk` } })
    for (const call of [enqueue.mock.calls[0], createAccountApprovedDelivery.mock.calls[0], insertSealedPayload.mock.calls[0]]) {
      expect(call?.[0]).toBe(tx)
    }
  })

  test("without a sealed payload it uses the plain topic, writes no sidecar and records the requested version", async () => {
    const { deps, enqueue, createRejectionDelivery, insertSealedPayload } = build()

    const queued = await enqueueEmail(tx, deps, {
      recipient: RECIPIENT,
      template: { templateKey: "application_rejected", applicationId: APPLICATION_ID },
      templateVersion: "v1",
      sesConfigurationSet: "boe-transactional",
      eventType: "application.rejected",
      eventVersion: 1,
      aggregateType: "application",
      aggregateId: APPLICATION_ID,
      requestId: APPROVAL.requestId,
      deduplicationKey: `application_rejected:${APPLICATION_ID}`,
      payload: { template: "application_rejected" },
    })

    expect(enqueue).toHaveBeenCalledWith(tx, {
      topic: "email",
      eventType: "application.rejected",
      eventVersion: 1,
      aggregateType: "application",
      aggregateId: APPLICATION_ID,
      requestId: APPROVAL.requestId,
      deduplicationKey: `application_rejected:${APPLICATION_ID}`,
      payload: { template: "application_rejected" },
    })
    expect(createRejectionDelivery).toHaveBeenCalledWith(tx, {
      outboxEventId: "outbox-1",
      applicationId: APPLICATION_ID,
      recipientCiphertext: expect.any(Buffer) as Buffer,
      recipientNonce: expect.any(Buffer) as Buffer,
      recipientHmac: crypto.hmacRecipient(RECIPIENT).hash,
      recipientMasked: "l***@example.com",
      recipientEncryptionKeyVersion: "ek1",
      suppressionHmacKeyVersion: "rk1",
      sesConfigurationSet: "boe-transactional",
      templateVersion: "v1",
    })
    expect(insertSealedPayload).not.toHaveBeenCalled()
    expect(queued.delivery.id).toBe("delivery-1")
  })
})
