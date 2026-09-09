import { describe, expect, test, vi } from "vitest"

import type { Transaction } from "../../db/repositories.js"
import { createClientAccount, type CreateClientAccountDeps } from "./createClientAccount.js"

const NOW = new Date("2026-09-08T12:00:00.000Z")
const TX = {} as Transaction

const deps = (conflict: unknown): CreateClientAccountDeps =>
  ({
    applicationRepository: { findActiveConflict: vi.fn().mockResolvedValue(conflict) },
    userRepository: {
      createAdminCreatedActive: vi
        .fn()
        .mockResolvedValue({ id: "user-1", version: "1", email_normalized: "a@b.test" }),
      lockById: vi.fn().mockResolvedValue({ id: "user-1", version: "1", email_normalized: "a@b.test" }),
    },
    emailVerificationRepository: {
      start: vi.fn().mockResolvedValue({ userId: "user-1", state: "pending", version: "2" }),
    },
    passwordTokenRepository: {
      latestCreatedAt: vi.fn().mockResolvedValue(null),
      consumeActive: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: "token-1" }),
    },
    credentialRepository: { create: vi.fn(), replace: vi.fn(), exists: vi.fn() },
    authSessionRepository: { revokeAllForUser: vi.fn() },
    auditRepository: { append: vi.fn().mockResolvedValue(undefined) },
    crypto: {
      generateVerificationToken: vi
        .fn()
        .mockReturnValue({ token: "opaque", hash: Buffer.alloc(32, 1), keyVersion: "v1" }),
      hashToken: vi.fn(),
    },
    clock: () => NOW,
    config: { tokenTtlMs: 600_000, maxAttempts: 5, requestCooldownMs: 60_000 },
  }) as unknown as CreateClientAccountDeps

const input = {
  emailNormalized: "a@b.test",
  phoneE164: "+919876543210",
  fullName: "A Person",
  actorUserId: "admin-1",
  requestId: "r1",
}

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

  test("leaves email verification pending so the account cannot invest yet", async () => {
    const d = deps(null)

    await createClientAccount(TX, d, input)

    expect(d.emailVerificationRepository.start).toHaveBeenCalledTimes(1)
  })
})
