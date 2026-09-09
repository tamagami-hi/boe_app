import { describe, expect, test, vi } from "vitest"

import { hashPassword } from "../../auth/passwordHasher.js"
import type { Transaction } from "../../db/repositories.js"
import {
  changePassword,
  redeemPasswordToken,
  type PasswordCredentialDeps,
} from "./passwordCredential.js"

const NOW = new Date("2026-09-08T12:00:00.000Z")
const TX = {} as Transaction
const HASH = Buffer.alloc(32, 7)

const activeToken = (overrides: Record<string, unknown> = {}) => ({
  id: "token-1",
  userId: "user-1",
  purpose: "reset" as const,
  tokenHash: HASH,
  tokenKeyVersion: "v1",
  attemptCount: 0,
  expiresAt: new Date(NOW.getTime() + 60_000),
  consumedAt: null,
  createdAt: NOW,
  ...overrides,
})

const deps = (overrides: Record<string, unknown> = {}): PasswordCredentialDeps => {
  const revokeAllForUser = vi.fn().mockResolvedValue({
    revokedSessionCount: 2,
    revokedRefreshTokenCount: 3,
  })
  return {
    passwordTokenRepository: {
      lockActiveByHash: vi.fn().mockResolvedValue(activeToken()),
      consume: vi.fn().mockResolvedValue(true),
      incrementAttempt: vi.fn().mockResolvedValue(undefined),
      consumeActive: vi.fn().mockResolvedValue(undefined),
      latestCreatedAt: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      lockActive: vi.fn(),
    },
    credentialRepository: {
      replace: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      exists: vi.fn(),
    },
    authSessionRepository: { revokeAllForUser } as unknown,
    userRepository: {
      lockById: vi.fn().mockResolvedValue({ id: "user-1", version: "1", email_normalized: "a@b.test" }),
      findPasswordHash: vi.fn().mockResolvedValue("$argon2id$stored"),
    },
    auditRepository: { append: vi.fn().mockResolvedValue(undefined) },
    crypto: {
      hashToken: vi.fn().mockReturnValue({ hash: HASH, keyVersion: "v1" }),
      generateVerificationToken: vi.fn(),
    },
    clock: () => NOW,
    config: { tokenTtlMs: 600_000, maxAttempts: 5, requestCooldownMs: 60_000 },
    ...overrides,
  } as unknown as PasswordCredentialDeps
}

describe("password reset token redemption", () => {
  test("refuses a token that is already consumed, so a link cannot be replayed", async () => {
    const d = deps()
    d.passwordTokenRepository.consume = vi.fn().mockResolvedValue(false)

    const outcome = await redeemPasswordToken(TX, d, {
      rawToken: "opaque",
      newPassword: "correct horse battery",
      requestId: "r1",
    })

    expect(outcome.kind).toBe("unknown_token")
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })

  test("refuses an expired token", async () => {
    const d = deps()
    d.passwordTokenRepository.lockActiveByHash = vi
      .fn()
      .mockResolvedValue(activeToken({ expiresAt: new Date(NOW.getTime() - 1) }))

    const outcome = await redeemPasswordToken(TX, d, {
      rawToken: "opaque",
      newPassword: "correct horse battery",
      requestId: "r1",
    })

    expect(outcome.kind).toBe("expired")
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })

  test("refuses a token past its attempt cap", async () => {
    const d = deps()
    d.passwordTokenRepository.lockActiveByHash = vi
      .fn()
      .mockResolvedValue(activeToken({ attemptCount: 5 }))

    const outcome = await redeemPasswordToken(TX, d, {
      rawToken: "opaque",
      newPassword: "correct horse battery",
      requestId: "r1",
    })

    expect(outcome.kind).toBe("locked")
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })

  test("refuses an unknown token without touching the credential", async () => {
    const d = deps()
    d.passwordTokenRepository.lockActiveByHash = vi.fn().mockResolvedValue(null)

    const outcome = await redeemPasswordToken(TX, d, {
      rawToken: "opaque",
      newPassword: "correct horse battery",
      requestId: "r1",
    })

    expect(outcome.kind).toBe("unknown_token")
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })

  test("revokes every session when it does replace the credential", async () => {
    const d = deps()

    const outcome = await redeemPasswordToken(TX, d, {
      rawToken: "opaque",
      newPassword: "correct horse battery",
      requestId: "r1",
    })

    expect(outcome.kind).toBe("redeemed")
    expect(d.credentialRepository.replace).toHaveBeenCalledTimes(1)
    expect(d.authSessionRepository.revokeAllForUser).toHaveBeenCalledTimes(1)
  })

  test("does not depend on the email verification repository at all", () => {
    expect(Object.keys(deps())).not.toContain("emailVerificationRepository")
  })
})

describe("password change", () => {
  test("rejects a wrong current password without revoking sessions", async () => {
    const d = deps()
    d.userRepository.findPasswordHash = vi
      .fn()
      .mockResolvedValue(await hashPassword("the actual password"))

    const outcome = await changePassword(TX, d, {
      userId: "user-1",
      currentPassword: "not the password",
      newPassword: "correct horse battery",
      requestId: "r1",
    })

    expect(outcome.kind).toBe("incorrect_password")
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
    expect(d.authSessionRepository.revokeAllForUser).not.toHaveBeenCalled()
  })

  test("accepts the correct current password and revokes every session", async () => {
    const d = deps()
    d.userRepository.findPasswordHash = vi
      .fn()
      .mockResolvedValue(await hashPassword("the actual password"))

    const outcome = await changePassword(TX, d, {
      userId: "user-1",
      currentPassword: "the actual password",
      newPassword: "correct horse battery",
      requestId: "r1",
    })

    expect(outcome.kind).toBe("changed")
    expect(d.credentialRepository.replace).toHaveBeenCalledTimes(1)
    expect(d.authSessionRepository.revokeAllForUser).toHaveBeenCalledTimes(1)
  })

  test("refuses an account with no stored credential", async () => {
    const d = deps()
    d.userRepository.findPasswordHash = vi.fn().mockResolvedValue(null)

    const outcome = await changePassword(TX, d, {
      userId: "user-1",
      currentPassword: "anything at all",
      newPassword: "correct horse battery",
      requestId: "r1",
    })

    expect(outcome.kind).toBe("no_credential")
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })
})
