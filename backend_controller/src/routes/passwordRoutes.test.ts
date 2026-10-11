import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { redeemPasswordToken } from "../domain/auth/passwordCredential.js"
import { issuePasswordLinkMail, queueAppDownloadMail } from "../domain/auth/passwordLinkMail.js"
import type { PasswordLinkSettings } from "../domain/auth/passwordLinkUrl.js"
import { AppError } from "../http/errorCatalog.js"
import { latestPublishedApkUrl } from "../release/releaseFeed.js"
import { createApplication } from "../runtime/application.js"
import { registerPasswordRoutes, type PasswordRoutesDeps } from "./passwordRoutes.js"

vi.mock("../domain/auth/passwordCredential.js", () => ({
  redeemPasswordToken: vi.fn(),
  changePassword: vi.fn(),
}))
vi.mock("../domain/auth/passwordLinkMail.js", () => ({
  issuePasswordLinkMail: vi.fn(),
  queueAppDownloadMail: vi.fn(),
}))
vi.mock("../release/releaseFeed.js", () => ({ latestPublishedApkUrl: vi.fn() }))

const TX = { transaction: "shared" }
const USABLE: PasswordLinkSettings = { clientUrl: "https://app.beonedge.in/reset-password", requireHttps: true }
const apkUrl = "https://app.beonedge.in/downloads/client/boe.prod.client.1.0.0.apk"
const payload = { token: "opaque-reset-token-1234", newPassword: "new password with enough length" }
const forgotPayload = { email: "client@example.com" }
const REDEEMED = {
  kind: "redeemed",
  tokenId: "token-1",
  userId: "user-1",
  purpose: "reset",
  email: "client@example.com",
} as const

let app: FastifyInstance | undefined
const logged: string[] = []
const findLoginIdentityByEmail = vi.fn()

interface Options {
  readonly commitFails?: boolean
  readonly accountExists?: boolean
  readonly passwordLinks?: PasswordLinkSettings
}

const buildApp = ({ commitFails = false, accountExists = true, passwordLinks = USABLE }: Options = {}): FastifyInstance => {
  findLoginIdentityByEmail.mockResolvedValue(accountExists ? { user: { id: "user-1" }, passwordHash: null } : null)
  return createApplication({
    destination: { write: (line: string) => void logged.push(line) },
    level: "info",
    registerRoutes: (instance) =>
      registerPasswordRoutes(instance, {
        unitOfWork: {
          execute: async (work: (tx: unknown) => Promise<unknown>) => {
            const outcome = await work(TX)
            if (commitFails) throw new Error("transaction failed")
            return outcome
          },
        },
        userRepository: { findLoginIdentityByEmail },
        appUpdate: { releaseRoot: "/apk", downloadBaseUrl: "https://app.beonedge.in/downloads" },
        config: { passwordLinks, sesConfigurationSet: "boe-transactional", tokenTtlMs: 600_000 },
      } as unknown as PasswordRoutesDeps),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  logged.length = 0
  vi.mocked(redeemPasswordToken).mockResolvedValue(REDEEMED)
  vi.mocked(latestPublishedApkUrl).mockResolvedValue(apkUrl)
  vi.mocked(queueAppDownloadMail).mockResolvedValue({ kind: "queued", deliveryId: "delivery-1" })
})
afterEach(async () => {
  await app?.close()
})

const reset = () => app?.inject({ method: "POST", url: "/v1/auth/password/reset", payload })
const forgot = () => app?.inject({ method: "POST", url: "/v1/auth/password/forgot", payload: forgotPayload })

test("queues the app download mail in the redemption's own transaction and never reports it sent", async () => {
  app = buildApp()
  const response = await reset()
  expect(response?.statusCode).toBe(200)
  expect(response?.json<{ data: unknown }>().data).toEqual({
    status: "password_set",
    downloadEmailStatus: "unconfirmed",
    downloadUrl: apkUrl,
  })
  const redeemTransaction = vi.mocked(redeemPasswordToken).mock.calls[0]?.[0]
  expect(redeemTransaction).toBe(TX)
  expect(queueAppDownloadMail).toHaveBeenCalledOnce()
  expect(vi.mocked(queueAppDownloadMail).mock.calls[0]?.[0]).toBe(redeemTransaction)
  expect(vi.mocked(queueAppDownloadMail).mock.calls[0]?.[2]).toMatchObject({
    tokenId: "token-1",
    userId: "user-1",
    email: "client@example.com",
    downloadUrl: apkUrl,
  })
})

test("does not queue anything for an invalid or replayed reset token", async () => {
  vi.mocked(redeemPasswordToken).mockResolvedValue({ kind: "unknown_token" })
  app = buildApp()
  const response = await reset()
  expect(response?.statusCode).toBe(401)
  expect(queueAppDownloadMail).not.toHaveBeenCalled()
})

test("answers 500 and claims nothing when the credential transaction rolls back", async () => {
  app = buildApp({ commitFails: true })
  const response = await reset()
  expect(response?.statusCode).toBe(500)
})

test("keeps the reset successful and logs the failure when the download mail could not be queued", async () => {
  vi.mocked(queueAppDownloadMail).mockResolvedValue({ kind: "failed", error: new Error("queue unavailable") })
  app = buildApp()
  const response = await reset()
  expect(response?.statusCode).toBe(200)
  expect(response?.json<{ data: unknown }>().data).toEqual({
    status: "password_set",
    downloadEmailStatus: "unconfirmed",
    downloadUrl: apkUrl,
  })
  expect(logged.join("\n")).toContain("could not be queued")
  expect(logged.join("\n")).not.toContain(payload.token)
})

test("does not claim a download email when no client APK is published and queues nothing", async () => {
  vi.mocked(latestPublishedApkUrl).mockResolvedValue(null)
  app = buildApp()
  const response = await reset()
  expect(response?.statusCode).toBe(200)
  expect(response?.json<{ data: unknown }>().data).toEqual({
    status: "password_set",
    downloadEmailStatus: "unavailable",
    downloadUrl: null,
  })
  expect(queueAppDownloadMail).not.toHaveBeenCalled()
})

test("keeps the reset successful without a download link when the published APK cannot be read", async () => {
  vi.mocked(latestPublishedApkUrl).mockRejectedValue(new Error("release root unreadable"))
  app = buildApp()
  const response = await reset()
  expect(response?.statusCode).toBe(200)
  expect(response?.json<{ data: unknown }>().data).toEqual({
    status: "password_set",
    downloadEmailStatus: "unconfirmed",
    downloadUrl: null,
  })
  expect(queueAppDownloadMail).not.toHaveBeenCalled()
})

test.each([
  ["an unknown address", false, undefined],
  ["a throttled account", true, new AppError("RATE_LIMITED")],
  ["an inactive account", true, new AppError("ACCOUNT_NOT_ACTIVE")],
] as const)(
  "answers a forgot request for %s exactly like one that queued a link",
  async (_label, accountExists, failure) => {
    if (failure !== undefined) vi.mocked(issuePasswordLinkMail).mockRejectedValue(failure)
    app = buildApp({ accountExists })
    const response = await forgot()
    expect(response?.statusCode).toBe(202)
    expect(response?.json<{ data: unknown }>().data).toEqual({ status: "accepted" })
    expect(issuePasswordLinkMail).toHaveBeenCalledTimes(accountExists ? 1 : 0)
  },
)

test("answers a forgot request for an active account with the same status and body, and queues the link", async () => {
  vi.mocked(issuePasswordLinkMail).mockResolvedValue({
    userId: "user-1",
    tokenId: "token-1",
    purpose: "reset",
    expiresAt: new Date("2026-09-08T12:10:00.000Z"),
    deliveryId: "delivery-1",
  })
  app = buildApp()
  const response = await forgot()
  expect(response?.statusCode).toBe(202)
  expect(response?.json<{ data: unknown }>().data).toEqual({ status: "accepted" })
  expect(issuePasswordLinkMail).toHaveBeenCalledOnce()
  expect(vi.mocked(issuePasswordLinkMail).mock.calls[0]?.[0]).toBe(TX)
  expect(vi.mocked(issuePasswordLinkMail).mock.calls[0]?.[2]).toMatchObject({
    userId: "user-1",
    requester: { kind: "user", userId: "user-1" },
    linkBase: USABLE.clientUrl,
  })
})

test("answers a forgot request the same way and logs an explicit error when the link address is unusable", async () => {
  app = buildApp({ passwordLinks: { clientUrl: null, requireHttps: true } })
  const response = await forgot()
  expect(response?.statusCode).toBe(202)
  expect(response?.json<{ data: unknown }>().data).toEqual({ status: "accepted" })
  expect(findLoginIdentityByEmail).not.toHaveBeenCalled()
  expect(issuePasswordLinkMail).not.toHaveBeenCalled()
  const errors = logged.map((line) => JSON.parse(line) as { level: number; msg: string }).filter((line) => line.level >= 50)
  expect(errors).toHaveLength(1)
  expect(errors[0]?.msg).toContain("CLIENT_PASSWORD_LINK_URL is not set")
  expect(logged.join("\n")).not.toContain(forgotPayload.email)
})
