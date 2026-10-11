import { beforeEach, describe, expect, test, vi } from "vitest"

import { hashPassword } from "../../auth/passwordHasher.js"
import type { Transaction } from "../../db/repositories.js"
import {
  changePassword,
  issuePasswordToken,
  redeemPasswordToken,
  type PasswordCredentialDeps,
} from "./passwordCredential.js"

const NOW = new Date("2026-09-08T12:00:00.000Z")
const TX = {} as Transaction
const HASH = Buffer.alloc(32, 7)
const COOLDOWN_MS = 60_000

let lockOrder: string[] = []

beforeEach(() => {
  lockOrder = []
})

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
  binding: { emailRevision: "1", credentialVersion: "3" },
  ...overrides,
})

const activeUser = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  version: "1",
  email_normalized: "a@b.test",
  account_state: "active",
  email_revision: "1",
  ...overrides,
})

const recorded = <T>(name: string, value: T) =>
  vi.fn().mockImplementation(() => {
    lockOrder.push(name)
    return Promise.resolve(value)
  })

const deps = (overrides: Record<string, unknown> = {}): PasswordCredentialDeps => {
  const revokeAllForUser = vi.fn().mockResolvedValue({
    revokedSessionCount: 2,
    revokedRefreshTokenCount: 3,
  })
  return {
    passwordTokenRepository: {
      findActiveByHash: recorded("token-read", activeToken()),
      lockActiveByHash: recorded("token", activeToken()),
      consume: vi.fn().mockResolvedValue(true),
      incrementAttempt: vi.fn().mockResolvedValue(undefined),
      consumeActive: recorded("token-supersede", undefined),
      latestCreatedAt: recorded("token-cooldown", null),
      create: vi.fn().mockResolvedValue({ id: "token-2" }),
      lockActive: vi.fn(),
    },
    credentialRepository: {
      lockByUserId: recorded("credential", { version: "3", hasPassword: true }),
      replace: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      exists: vi.fn(),
    },
    authSessionRepository: { revokeAllForUser } as unknown,
    userRepository: {
      lockById: recorded("user", activeUser()),
      findPasswordHash: vi.fn().mockResolvedValue("$argon2id$stored"),
    },
    auditRepository: { append: vi.fn().mockResolvedValue(undefined) },
    crypto: {
      hashToken: vi.fn().mockReturnValue({ hash: HASH, keyVersion: "v1" }),
      generateVerificationToken: vi
        .fn()
        .mockReturnValue({ token: "opaque-new-token", hash: Buffer.alloc(32, 9), keyVersion: "v1" }),
    },
    clock: () => NOW,
    config: { tokenTtlMs: 600_000, maxAttempts: 5, requestCooldownMs: COOLDOWN_MS },
    ...overrides,
  } as unknown as PasswordCredentialDeps
}

const redeem = (d: PasswordCredentialDeps) =>
  redeemPasswordToken(TX, d, {
    rawToken: "opaque",
    newPassword: "correct horse battery",
    requestId: "r1",
  })

describe("password link issuance", () => {
  const issue = (d: PasswordCredentialDeps, requester: Parameters<typeof issuePasswordToken>[2]["requester"] = { kind: "user", userId: "user-1" }) =>
    issuePasswordToken(TX, d, { userId: "user-1", requestId: "r1", requester })

  test("issues a set link when no password exists, bound to revision 1 and to no credential", async () => {
    const d = deps({
      credentialRepository: { lockByUserId: recorded("credential", null) },
    })

    const issued = await issue(d)

    expect(issued.purpose).toBe("set")
    expect(d.passwordTokenRepository.create).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ purpose: "set", binding: { emailRevision: "1", credentialVersion: "0" } }),
    )
  })

  test("issues a reset link when a password exists, bound to the current credential version", async () => {
    const d = deps({
      userRepository: { lockById: recorded("user", activeUser({ email_revision: "4" })) },
    })

    const issued = await issue(d)

    expect(issued.purpose).toBe("reset")
    expect(d.passwordTokenRepository.create).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ purpose: "reset", binding: { emailRevision: "4", credentialVersion: "3" } }),
    )
  })

  test.each(["invited", "suspended", "closed"])("issues nothing for a %s account", async (state) => {
    const d = deps({
      userRepository: { lockById: recorded("user", activeUser({ account_state: state })) },
    })

    await expect(issue(d)).rejects.toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" })

    expect(d.passwordTokenRepository.create).not.toHaveBeenCalled()
    expect(d.passwordTokenRepository.consumeActive).not.toHaveBeenCalled()
    expect(d.auditRepository.append).not.toHaveBeenCalled()
  })

  test("keeps the per-user cooldown: refuses inside it and issues at exactly its end", async () => {
    const inside = deps({
      passwordTokenRepository: {
        latestCreatedAt: vi.fn().mockResolvedValue(new Date(NOW.getTime() - COOLDOWN_MS + 1)),
        consumeActive: vi.fn(),
        create: vi.fn(),
      },
    })
    await expect(issue(inside)).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(inside.passwordTokenRepository.consumeActive).not.toHaveBeenCalled()
    expect(inside.passwordTokenRepository.create).not.toHaveBeenCalled()

    const atEnd = deps({
      passwordTokenRepository: {
        latestCreatedAt: vi.fn().mockResolvedValue(new Date(NOW.getTime() - COOLDOWN_MS)),
        consumeActive: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "token-2" }),
      },
    })
    await expect(issue(atEnd)).resolves.toMatchObject({ purpose: "reset" })
  })

  test("retires the older link before it creates the newer one", async () => {
    const d = deps()

    await issue(d)

    expect(lockOrder).toEqual(["user", "credential", "token-cooldown", "token-supersede"])
    expect(vi.mocked(d.passwordTokenRepository.consumeActive).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(d.passwordTokenRepository.create).mock.invocationCallOrder[0] ?? 0,
    )
  })

  test.each([
    [{ kind: "admin", userId: "admin-1" } as const, "admin", "admin-1"],
    [{ kind: "user", userId: "user-1" } as const, "user", "user-1"],
    [{ kind: "system" } as const, "system", null],
  ])("attributes the audit row to the requester %j", async (requester, actorType, actorUserId) => {
    const d = deps()

    await issue(d, requester)

    expect(d.auditRepository.append).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ actorType, actorUserId, entityId: "user-1", command: "password.reset_requested" }),
    )
  })
})

describe("password reset token redemption", () => {
  test("refuses a token that is already consumed, so a link cannot be replayed", async () => {
    const d = deps()
    d.passwordTokenRepository.consume = vi.fn().mockResolvedValue(false)

    const outcome = await redeem(d)

    expect(outcome.kind).toBe("unknown_token")
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })

  test("refuses an expired token", async () => {
    const d = deps()
    d.passwordTokenRepository.lockActiveByHash = vi
      .fn()
      .mockResolvedValue(activeToken({ expiresAt: new Date(NOW.getTime() - 1) }))

    const outcome = await redeem(d)

    expect(outcome.kind).toBe("expired")
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })

  test("refuses a token past its attempt cap", async () => {
    const d = deps()
    d.passwordTokenRepository.lockActiveByHash = vi
      .fn()
      .mockResolvedValue(activeToken({ attemptCount: 5 }))

    const outcome = await redeem(d)

    expect(outcome.kind).toBe("locked")
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })

  test("refuses an unknown token without touching the credential", async () => {
    const d = deps()
    d.passwordTokenRepository.findActiveByHash = vi.fn().mockResolvedValue(null)

    const outcome = await redeem(d)

    expect(outcome.kind).toBe("unknown_token")
    expect(d.userRepository.lockById).not.toHaveBeenCalled()
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
  })

  const REJECTIONS: ReadonlyArray<readonly [string, (d: PasswordCredentialDeps) => void, string]> = [
    [
      "a token with no binding",
      (d) => {
        d.passwordTokenRepository.lockActiveByHash = vi.fn().mockResolvedValue(activeToken({ binding: null }))
      },
      "unbound",
    ],
    [
      "a suspended account",
      (d) => {
        d.userRepository.lockById = vi.fn().mockResolvedValue(activeUser({ account_state: "suspended" }))
      },
      "inactive_account",
    ],
    [
      "a moved email revision",
      (d) => {
        d.userRepository.lockById = vi.fn().mockResolvedValue(activeUser({ email_revision: "2" }))
      },
      "stale_email",
    ],
    [
      "a newer credential",
      (d) => {
        d.credentialRepository.lockByUserId = vi.fn().mockResolvedValue({ version: "4", hasPassword: true })
      },
      "stale_credential",
    ],
    [
      "a set link over an existing password",
      (d) => {
        d.passwordTokenRepository.lockActiveByHash = vi.fn().mockResolvedValue(activeToken({ purpose: "set" }))
      },
      "credential_present",
    ],
  ]

  test.each(REJECTIONS)("refuses %s and changes nothing", async (_label, arrange, kind) => {
    const d = deps()
    arrange(d)

    const outcome = await redeem(d)

    expect(outcome.kind).toBe(kind)
    expect(d.passwordTokenRepository.consume).not.toHaveBeenCalled()
    expect(d.credentialRepository.replace).not.toHaveBeenCalled()
    expect(d.authSessionRepository.revokeAllForUser).not.toHaveBeenCalled()
  })

  test("accepts a set link while no password exists yet", async () => {
    const d = deps({
      credentialRepository: { lockByUserId: recorded("credential", null), replace: vi.fn().mockResolvedValue({}) },
    })
    d.passwordTokenRepository.lockActiveByHash = vi
      .fn()
      .mockResolvedValue(activeToken({ purpose: "set", binding: { emailRevision: "1", credentialVersion: "0" } }))

    const outcome = await redeem(d)

    expect(outcome).toMatchObject({ kind: "redeemed", purpose: "set" })
  })

  test("revokes every session and every other outstanding link when it replaces the credential", async () => {
    const d = deps()

    const outcome = await redeem(d)

    expect(outcome.kind).toBe("redeemed")
    expect(d.credentialRepository.replace).toHaveBeenCalledTimes(1)
    expect(d.authSessionRepository.revokeAllForUser).toHaveBeenCalledTimes(1)
    expect(d.passwordTokenRepository.consumeActive).toHaveBeenCalledWith(TX, { userId: "user-1", now: NOW })
  })

  test("takes the user, then the credential, then the token row lock", async () => {
    const d = deps()

    await redeem(d)

    expect(lockOrder).toEqual(["token-read", "user", "credential", "token", "token-supersede"])
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
    expect(d.passwordTokenRepository.consumeActive).not.toHaveBeenCalled()
  })

  test("accepts the correct current password, revokes every session and retires every outstanding link", async () => {
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
    expect(lockOrder).toEqual(["user", "credential", "token-supersede"])
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
