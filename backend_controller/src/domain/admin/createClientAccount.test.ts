import { randomBytes } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../crypto/context.js"
import type { Transaction } from "../../db/repositories.js"
import type { PasswordLinkSettings } from "../auth/passwordLinkUrl.js"
import { createClientAccount, type CreateClientAccountDeps } from "./createClientAccount.js"

const NOW = new Date("2026-09-08T12:00:00.000Z")
const TX = {} as Transaction
const LINK_BASE = "https://app.beonedge.example/reset-password"
const USABLE: PasswordLinkSettings = { clientUrl: LINK_BASE, requireHttps: true }

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

const deps = (conflict: unknown, passwordLinks: PasswordLinkSettings = USABLE): CreateClientAccountDeps =>
  ({
    applicationRepository: { findActiveConflict: vi.fn().mockResolvedValue(conflict) },
    identityLockRepository: { lockIdentities: vi.fn().mockResolvedValue(undefined) },
    userRepository: {
      createAdminCreatedActive: vi
        .fn()
        .mockResolvedValue({ id: "user-1", version: "1", email_normalized: "a@b.test" }),
      lockById: vi.fn().mockResolvedValue({
        id: "user-1",
        version: "1",
        email_normalized: "a@b.test",
        account_state: "active",
        email_revision: "1",
      }),
    },
    emailVerificationRepository: {
      start: vi.fn().mockResolvedValue({ userId: "user-1", state: "pending", version: "2" }),
    },
    passwordTokenRepository: {
      latestCreatedAt: vi.fn().mockResolvedValue(null),
      consumeActive: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: "token-1" }),
    },
    credentialRepository: {
      lockByUserId: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      replace: vi.fn(),
      exists: vi.fn(),
    },
    authSessionRepository: { revokeAllForUser: vi.fn() },
    auditRepository: { append: vi.fn().mockResolvedValue(undefined) },
    outboxRepository: { enqueue: vi.fn().mockResolvedValue({ id: "outbox-1" }) },
    emailDeliveryRepository: {
      createUserMailDelivery: vi.fn().mockResolvedValue({ id: "delivery-1" }),
      insertSealedPayload: vi.fn().mockResolvedValue(undefined),
    },
    crypto,
    clock: () => NOW,
    config: {
      tokenTtlMs: 600_000,
      maxAttempts: 5,
      requestCooldownMs: 60_000,
      passwordLinks,
      sesConfigurationSet: "boe-transactional",
    },
  }) as unknown as CreateClientAccountDeps

const input = {
  emailNormalized: "a@b.test",
  phoneE164: "+919876543210",
  fullName: "A Person",
  actorUserId: "admin-1",
  requestId: "r1",
}

const writes = (d: CreateClientAccountDeps): unknown[] => [
  d.userRepository.createAdminCreatedActive,
  d.emailVerificationRepository.start,
  d.passwordTokenRepository.create,
  d.auditRepository.append,
  d.outboxRepository.enqueue,
  d.emailDeliveryRepository.createUserMailDelivery,
  d.emailDeliveryRepository.insertSealedPayload,
]

describe("admin-created client accounts", () => {
  test("refuses an identity that already owns an account", async () => {
    const d = deps({ kind: "user", userId: "other", userVersion: 1, matchedOn: "email" })

    await expect(createClientAccount(TX, d, input)).rejects.toThrow()
    expect(d.userRepository.createAdminCreatedActive).not.toHaveBeenCalled()
  })

  test("refuses an identity with a signup application still in flight", async () => {
    const d = deps({
      kind: "application",
      application: { id: "app-1", state: "submitted", version: "1" },
      matchedOn: "phone",
    })

    await expect(createClientAccount(TX, d, input)).rejects.toThrow()
    expect(d.userRepository.createAdminCreatedActive).not.toHaveBeenCalled()
  })

  test("creates no credential, so no operator ever knows the password", async () => {
    const d = deps(null)

    const created = await createClientAccount(TX, d, input)

    expect(created.userId).toBe("user-1")
    expect(d.credentialRepository.create).not.toHaveBeenCalled()
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })

  test("invites with a set link bound to no credential, requested by the creating admin", async () => {
    const d = deps(null)

    const created = await createClientAccount(TX, d, input)

    expect(created.passwordLink.purpose).toBe("set")
    expect(d.passwordTokenRepository.create).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ purpose: "set", binding: { emailRevision: "1", credentialVersion: "0" } }),
    )
    expect(d.auditRepository.append).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ actorType: "admin", actorUserId: "admin-1", command: "password.set_requested" }),
    )
  })

  test("leaves email verification pending so the account cannot invest yet", async () => {
    const d = deps(null)

    await createClientAccount(TX, d, input)

    expect(d.emailVerificationRepository.start).toHaveBeenCalledTimes(1)
  })

  test("queues the set-link mail in the caller's transaction with the link only in the sealed payload", async () => {
    const d = deps(null)

    const created = await createClientAccount(TX, d, input)

    expect(created.passwordLink).toMatchObject({ userId: "user-1", tokenId: "token-1", deliveryId: "delivery-1" })
    const [, outbox] = vi.mocked(d.outboxRepository.enqueue).mock.calls[0] ?? []
    const [, delivery] = vi.mocked(d.emailDeliveryRepository.createUserMailDelivery).mock.calls[0] ?? []
    const [, sealed] = vi.mocked(d.emailDeliveryRepository.insertSealedPayload).mock.calls[0] ?? []
    if (outbox === undefined || delivery === undefined || sealed === undefined) throw new Error("mail was not queued")
    expect(outbox).toMatchObject({
      topic: "email.sealed",
      aggregateId: "user-1",
      deduplicationKey: "password_link:token-1",
      payload: { template: "password_set_link", passwordTokenId: "token-1", validForMs: 600_000 },
    })
    expect(delivery).toMatchObject({ templateKey: "password_set_link", userId: "user-1", templateVersion: "v1" })
    const opened = crypto.decryptDeliveryPayload("delivery-1", {
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
      keyVersion: sealed.keyVersion,
    })
    if (opened.kind !== "opened") throw new Error("the sealed payload could not be opened")
    const link = new URL(String(opened.payload.link))
    expect(`${link.origin}${link.pathname}`).toBe(LINK_BASE)
    const token = link.searchParams.get("token") ?? ""
    expect(token.length).toBeGreaterThan(16)
    expect(JSON.stringify([outbox, delivery, vi.mocked(d.auditRepository.append).mock.calls])).not.toContain(token)
    for (const call of [
      vi.mocked(d.outboxRepository.enqueue).mock.calls[0],
      vi.mocked(d.emailDeliveryRepository.createUserMailDelivery).mock.calls[0],
      vi.mocked(d.emailDeliveryRepository.insertSealedPayload).mock.calls[0],
    ]) {
      expect(call?.[0]).toBe(TX)
    }
  })

  test.each([
    ["no link address configured", { clientUrl: null, requireHttps: true }],
    ["an empty link address", { clientUrl: "", requireHttps: true }],
    ["a relative address", { clientUrl: "/reset-password", requireHttps: true }],
    ["a non-web scheme", { clientUrl: "ftp://app.beonedge.example/reset-password", requireHttps: false }],
    ["credentials in the address", { clientUrl: "https://admin:secret@app.beonedge.example/reset-password", requireHttps: true }],
    ["a query string", { clientUrl: `${LINK_BASE}?x=1`, requireHttps: true }],
    ["a fragment", { clientUrl: `${LINK_BASE}#top`, requireHttps: true }],
    ["cleartext http where https is required", { clientUrl: "http://app.beonedge.example/reset-password", requireHttps: true }],
  ] satisfies [string, PasswordLinkSettings][])(
    "writes nothing and answers unavailable for %s",
    async (_name, settings) => {
      const d = deps(null, settings)

      await expect(createClientAccount(TX, d, input)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" })

      expect(d.applicationRepository.findActiveConflict).not.toHaveBeenCalled()
      for (const write of writes(d)) expect(write).not.toHaveBeenCalled()
    },
  )

  test("does not hide a queueing failure, so the surrounding transaction rolls the account back", async () => {
    const d = deps(null)
    vi.mocked(d.outboxRepository.enqueue).mockRejectedValue(new Error("outbox unavailable"))

    await expect(createClientAccount(TX, d, input)).rejects.toThrow("outbox unavailable")
  })
})
