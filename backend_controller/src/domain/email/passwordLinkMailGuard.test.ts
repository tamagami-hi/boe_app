import { describe, expect, test, vi } from "vitest"

import type { EmailDelivery, OutboxEvent, Transaction } from "../../db/repositories.js"
import type { LockedCredential } from "../../repositories/credentialRepository.js"
import type {
  PasswordTokenRepository,
  PasswordTokenValidityContext,
} from "../../repositories/passwordTokenRepository.js"
import { createPasswordLinkMailGuard } from "./passwordLinkMailGuard.js"

const NOW = new Date("2026-03-01T10:00:00.000Z")
const TOKEN_ID = "11111111-1111-4111-8111-111111111111"
const USER_ID = "22222222-2222-4222-8222-222222222222"
const TX = {} as Transaction

interface Overrides {
  readonly token?: Partial<PasswordTokenValidityContext["token"]>
  readonly user?: Partial<PasswordTokenValidityContext["user"]>
  readonly credential?: LockedCredential | null
}

const contextWith = (overrides: Overrides = {}): PasswordTokenValidityContext => ({
  token: {
    id: TOKEN_ID,
    userId: USER_ID,
    purpose: "set",
    expiresAt: new Date(NOW.getTime() + 300_000),
    consumedAt: null,
    binding: { emailRevision: "1", credentialVersion: "0" },
    ...overrides.token,
  },
  user: { account_state: "active", email_revision: "1", ...overrides.user },
  credential: overrides.credential === undefined ? null : overrides.credential,
})

const verdictFor = async (
  stored: PasswordTokenValidityContext | null,
  payload: unknown = { template: "password_set_link", passwordTokenId: TOKEN_ID, validForMs: 600_000 },
) => {
  const findValidityContext = vi.fn<PasswordTokenRepository["findValidityContext"]>(() => Promise.resolve(stored))
  const guard = createPasswordLinkMailGuard({ passwordTokenRepository: { findValidityContext } })
  const verdict = await guard(TX, {
    event: { payload } as OutboxEvent,
    delivery: { user_id: USER_ID } as EmailDelivery,
    now: NOW,
  })
  return { verdict, findValidityContext }
}

describe("password link mail guard", () => {
  test("lets a mail for the current, correctly bound link go out", async () => {
    expect((await verdictFor(contextWith())).verdict).toEqual({ kind: "send" })
    expect(
      (
        await verdictFor(
          contextWith({
            token: { purpose: "reset", binding: { emailRevision: "1", credentialVersion: "3" } },
            credential: { version: "3", hasPassword: true },
          }),
        )
      ).verdict,
    ).toEqual({ kind: "send" })
  })

  test("asks the repository only for the referenced token", async () => {
    const { findValidityContext } = await verdictFor(contextWith())

    expect(findValidityContext).toHaveBeenCalledTimes(1)
    expect(findValidityContext).toHaveBeenCalledWith(TX, TOKEN_ID)
  })

  test.each<[string, PasswordTokenValidityContext | null, string]>([
    ["no longer exists", null, "token_missing"],
    ["belongs to another account", contextWith({ token: { userId: "33333333-3333-4333-8333-333333333333" } }), "user_mismatch"],
    ["was consumed or superseded", contextWith({ token: { consumedAt: new Date(NOW.getTime() - 1_000) } }), "consumed"],
    ["expires at this very moment", contextWith({ token: { expiresAt: NOW } }), "expired"],
    ["has expired", contextWith({ token: { expiresAt: new Date(NOW.getTime() - 60_000) } }), "expired"],
    ["carries no binding", contextWith({ token: { binding: null } }), "unbound"],
    ["belongs to a suspended account", contextWith({ user: { account_state: "suspended" } }), "inactive_account"],
    ["belongs to a closed account", contextWith({ user: { account_state: "closed" } }), "inactive_account"],
    ["was bound to an earlier email address", contextWith({ user: { email_revision: "2" } }), "stale_email"],
    [
      "was bound to an earlier credential",
      contextWith({ credential: { version: "2", hasPassword: true }, token: { purpose: "reset" } }),
      "stale_credential",
    ],
    [
      "sets a password the account already has",
      contextWith({
        token: { binding: { emailRevision: "1", credentialVersion: "1" } },
        credential: { version: "1", hasPassword: true },
      }),
      "credential_present",
    ],
  ])("cancels the mail for a link that %s", async (_name, stored, reason) => {
    expect((await verdictFor(stored)).verdict).toEqual({ kind: "cancel", reason })
  })

  test.each<[string, unknown]>([
    ["no payload", null],
    ["a payload without the reference", { template: "password_set_link" }],
    ["a numeric reference", { passwordTokenId: 7 }],
    ["a reference that is not a uuid", { passwordTokenId: "1' or '1'='1" }],
  ])("cancels the mail without querying when it carries %s", async (_name, payload) => {
    const { verdict, findValidityContext } = await verdictFor(contextWith(), payload)

    expect(verdict).toEqual({ kind: "cancel", reason: "reference_missing" })
    expect(findValidityContext).not.toHaveBeenCalled()
  })
})
