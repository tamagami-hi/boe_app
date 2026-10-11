import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import type { CryptoContext } from "../../src/crypto/context.js"
import { hashPassword } from "../../src/auth/passwordHasher.js"
import { redeemPasswordToken } from "../../src/domain/auth/passwordCredential.js"
import { queueAppDownloadMail } from "../../src/domain/auth/passwordLinkMail.js"
import { composeEmailDispatchWorker } from "../../src/runtime/workerComposition.js"
import {
  CRYPTO_ENV,
  NEW_PASSWORD,
  PasswordMailStack,
  TTL_MS,
  type SeededUser,
  type TransportHandle,
} from "./passwordMailSupport.js"

const DOWNLOAD_URL = "https://app.beonedge.test/downloads/client/boe.prod.client.1.0.0.apk"
const LATER = (): Date => new Date(Date.now() + TTL_MS + 5_000)

let stack: PasswordMailStack

const mailsTo = (sender: TransportHandle, user: SeededUser) =>
  sender.messages.filter((message) => message.to === user.email)

const expectCancelledUnsent = async (deliveryId: string): Promise<void> => {
  expect(await stack.deliveryRow(deliveryId)).toMatchObject({
    state: "cancelled",
    cancelled_at: expect.any(Date) as Date,
    attempt_count: 0,
  })
  expect(await stack.outboxRowOf(deliveryId)).toMatchObject({ state: "cancelled", attempt_count: 0 })
  expect(await stack.payloadRow(deliveryId)).toMatchObject({
    ciphertext: null,
    nonce: null,
    scrubbed_at: expect.any(Date) as Date,
  })
  expect(await stack.attemptRows(deliveryId)).toEqual([])
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: false })
}, 220_000)

afterAll(async () => {
  await stack.stop()
})

beforeEach(() => {
  stack.clockOffsetMs = 0
})

describe("a current password link mail", () => {
  test.each([
    ["set", false, "Set your BeOnEdge password"],
    ["reset", true, "Reset your BeOnEdge password"],
  ] as const)("a %s link is sent with its sealed link in the body, then nothing readable is left in the database", async (purpose, hasPassword, subject) => {
    const user = await stack.seedUser({ password: hasPassword })
    const queued = await stack.queueLink(user.id)
    const { link, rawToken } = await stack.linkOf(queued.deliveryId)
    const sender = stack.transport()

    await stack.dispatch(sender)

    expect(queued.purpose).toBe(purpose)
    const [message, ...others] = mailsTo(sender, user)
    expect(others).toEqual([])
    expect(message?.subject).toBe(subject)
    expect(message?.text).toContain(link)
    expect(message?.html).toContain(link)
    expect(message?.subject).not.toContain(rawToken)
    expect(await stack.deliveryRow(queued.deliveryId)).toMatchObject({ state: "sent", attempt_count: 1 })
    expect(await stack.outboxRowOf(queued.deliveryId)).toMatchObject({ state: "delivered" })
    expect(await stack.payloadRow(queued.deliveryId)).toMatchObject({ ciphertext: null, scrubbed_at: expect.any(Date) as Date })
    expect(await stack.attemptRows(queued.deliveryId)).toMatchObject([{ generation: 1, outcome: "accepted" }])
    expect(await stack.rowsMentioning(rawToken)).toBe(0)
    expect(await stack.rowsMentioning(link)).toBe(0)
  })

  test("a retry sends the very same link again and issues no new token", async () => {
    const user = await stack.seedUser({ password: true })
    const queued = await stack.queueLink(user.id)
    const { link } = await stack.linkOf(queued.deliveryId)

    await stack.dispatch(stack.transport("time_out"))
    expect(await stack.deliveryRow(queued.deliveryId)).toMatchObject({ state: "retryable_failed" })
    expect(await stack.payloadRow(queued.deliveryId)).toMatchObject({ scrubbed_at: null })

    const sender = stack.transport()
    await stack.dispatch(sender, () => new Date(Date.now() + 80_000))

    expect(mailsTo(sender, user).map((message) => message.text.includes(link))).toEqual([true])
    expect(await stack.deliveryRow(queued.deliveryId)).toMatchObject({ state: "sent", attempt_count: 2 })
    expect(await stack.count("password_credential_tokens", "user_id = $1", [user.id])).toBe(1)
  })
})

describe("a password link mail that is no longer current is cancelled unsent", () => {
  interface Scenario {
    readonly name: string
    readonly password: boolean
    readonly arrange: (user: SeededUser, rawToken: string) => Promise<void>
    readonly clock?: () => Date
  }

  const SCENARIOS: readonly Scenario[] = [
    {
      name: "its link was redeemed",
      password: true,
      arrange: async (_user, rawToken) => {
        const outcome = await stack.unitOfWork.execute((tx) =>
          redeemPasswordToken(tx, stack.mailDeps(), { rawToken, newPassword: NEW_PASSWORD, requestId: randomUUID() }),
        )
        expect(outcome.kind).toBe("redeemed")
      },
    },
    { name: "its link expired", password: true, arrange: () => Promise.resolve(), clock: LATER },
    {
      name: "the account was suspended",
      password: true,
      arrange: (user) => stack.setAccountState(user.id, "suspended"),
    },
    {
      name: "the account was closed",
      password: true,
      arrange: (user) => stack.setAccountState(user.id, "closed"),
    },
    {
      name: "the email address changed",
      password: true,
      arrange: async (user) => {
        await stack.pool.query("update users set email_revision = email_revision + 1 where id = $1", [user.id])
      },
    },
    {
      name: "the password was replaced by a path that retires no links",
      password: true,
      arrange: async (user) => {
        await stack.pool.query(
          "update user_credentials set password_hash = $2, version = version + 1 where user_id = $1",
          [user.id, await hashPassword("a password set somewhere else")],
        )
      },
    },
    {
      name: "a password appeared after a set link was issued",
      password: false,
      arrange: async (user) => {
        await stack.pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [
          user.id,
          stack.passwordHash,
        ])
      },
    },
  ]

  test.each(SCENARIOS)("when $name", async (scenario) => {
    const user = await stack.seedUser({ password: scenario.password })
    const queued = await stack.queueLink(user.id)
    const { rawToken } = await stack.linkOf(queued.deliveryId)
    await scenario.arrange(user, rawToken)
    const sender = stack.transport()

    const summary = await stack.dispatch(sender, scenario.clock)

    expect(summary.cancelled).toBeGreaterThanOrEqual(1)
    expect(mailsTo(sender, user)).toEqual([])
    await expectCancelledUnsent(queued.deliveryId)
    expect(await stack.rowsMentioning(rawToken)).toBe(0)
  })

  test("when a newer link was issued, only the newer link's mail goes out", async () => {
    const user = await stack.seedUser({ password: true })
    const older = await stack.queueLink(user.id)
    const olderLink = await stack.linkOf(older.deliveryId)
    stack.clockOffsetMs = 61_000
    const newer = await stack.queueLink(user.id)
    const newerLink = await stack.linkOf(newer.deliveryId)
    const sender = stack.transport()

    await stack.dispatch(sender)

    await expectCancelledUnsent(older.deliveryId)
    const sent = mailsTo(sender, user)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain(newerLink.link)
    expect(sent[0]?.text).not.toContain(olderLink.rawToken)
    expect(await stack.deliveryRow(newer.deliveryId)).toMatchObject({ state: "sent" })
  })

  test("when the link expires between a failed attempt and its retry, the retry is cancelled and the first attempt is kept", async () => {
    const user = await stack.seedUser({ password: true })
    const queued = await stack.queueLink(user.id)
    await stack.dispatch(stack.transport("time_out"))
    expect(await stack.deliveryRow(queued.deliveryId)).toMatchObject({ state: "retryable_failed", attempt_count: 1 })
    const sender = stack.transport()

    await stack.dispatch(sender, LATER)

    expect(mailsTo(sender, user)).toEqual([])
    expect(await stack.deliveryRow(queued.deliveryId)).toMatchObject({ state: "cancelled", attempt_count: 1 })
    expect(await stack.outboxRowOf(queued.deliveryId)).toMatchObject({ state: "cancelled", attempt_count: 1 })
    expect(await stack.payloadRow(queued.deliveryId)).toMatchObject({ ciphertext: null, scrubbed_at: expect.any(Date) as Date })
    expect(await stack.attemptRows(queued.deliveryId)).toMatchObject([{ generation: 1, outcome: "retryable" }])
  })

  test("without ever opening the sealed payload", async () => {
    const user = await stack.seedUser({ password: true })
    const queued = await stack.queueLink(user.id)
    await stack.setAccountState(user.id, "suspended")
    const decrypt = vi.fn<CryptoContext["decryptDeliveryPayload"]>(stack.crypto.decryptDeliveryPayload)

    await stack.dispatch(stack.transport(), undefined, { ...stack.crypto, decryptDeliveryPayload: decrypt })

    expect(decrypt).not.toHaveBeenCalled()
    await expectCancelledUnsent(queued.deliveryId)
  })
})

describe("a delivery whose recipient is missing", () => {
  test("is cancelled together with its outbox event, loses its payload and sends nothing", async () => {
    const user = await stack.seedUser({ password: true })
    const queued = await stack.queueLink(user.id)
    await stack.pool.query(
      "update email_deliveries set recipient_ciphertext = null, recipient_nonce = null, " +
        "recipient_encryption_key_version = null, erased_at = now() where id = $1",
      [queued.deliveryId],
    )
    const sender = stack.transport()

    const summary = await stack.dispatch(sender)

    expect(summary.cancelled).toBeGreaterThanOrEqual(1)
    expect(sender.messages.filter((message) => message.text.includes("reset-password"))).toEqual([])
    await expectCancelledUnsent(queued.deliveryId)
  })
})

describe("the app download mail", () => {
  test("is sent from its plain payload and needs no sidecar", async () => {
    const user = await stack.seedUser({ password: true })
    const tokenId = randomUUID()

    const queued = await stack.unitOfWork.execute((tx) =>
      queueAppDownloadMail(tx, stack.mailDeps(), {
        tokenId,
        userId: user.id,
        email: user.email,
        downloadUrl: DOWNLOAD_URL,
        requestId: randomUUID(),
      }),
    )
    if (queued.kind !== "queued") throw new Error("the download mail was not queued")
    const sender = stack.transport()

    await stack.dispatch(sender)

    expect(await stack.outboxRowOf(queued.deliveryId)).toMatchObject({
      topic: "email",
      state: "delivered",
      payload: { template: "password_app_download", downloadUrl: DOWNLOAD_URL },
    })
    expect(await stack.deliveryRow(queued.deliveryId)).toMatchObject({
      state: "sent",
      template_key: "password_app_download",
      application_id: null,
      user_id: user.id,
    })
    const [message] = mailsTo(sender, user)
    expect(message?.subject).toBe("BeOnEdge password set: download the app")
    expect(message?.text).toContain(DOWNLOAD_URL)
    expect(await stack.payloadRow(queued.deliveryId)).toEqual({})
  })
})

describe("the composed email worker", () => {
  const workerEnv = (): Record<string, string> => {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" })
    return {
      ...CRYPTO_ENV,
      DATABASE_URL: stack.container.getConnectionUri(),
      ACCESS_TOKEN_ISSUER: "https://test.example",
      ACCESS_TOKEN_AUDIENCE: "boe-test",
      ACCESS_TOKEN_CURRENT_KID: "test-k1",
      ACCESS_TOKEN_SIGNING_KEY: pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      ACCESS_TOKEN_VERIFICATION_KEYS: JSON.stringify({
        "test-k1": pair.publicKey.export({ type: "spki", format: "pem" }) as string,
      }),
      REFRESH_HMAC_KEY: randomBytes(32).toString("base64"),
      REFRESH_KEY_VERSION: "rt1",
      CSRF_KEY_VERSION: "cs1",
      CURSOR_HMAC_KEY: randomBytes(32).toString("base64"),
      WEB_COOKIE_SECURE: "false",
      WEB_ORIGIN_ALLOWLIST: "https://admin.beonedge.test",
      PASSWORD_BREACH_CHECK_MODE: "bypass",
      NODE_ENV: "test",
    }
  }

  test("guards password link mail, so a superseded link is cancelled and the current one is attempted", async () => {
    const user = await stack.seedUser({ password: true })
    const older = await stack.queueLink(user.id)
    stack.clockOffsetMs = 61_000
    const newer = await stack.queueLink(user.id)
    const worker = composeEmailDispatchWorker(workerEnv())
    try {
      await worker.runOnce()
    } finally {
      await worker.dispose()
    }

    expect(worker.transportConfigured).toBe(false)
    await expectCancelledUnsent(older.deliveryId)
    expect(await stack.deliveryRow(newer.deliveryId)).toMatchObject({
      state: "retryable_failed",
      last_error_code: "EMAIL_TRANSPORT_NOT_CONFIGURED",
    })
  })
})
