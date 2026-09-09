import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import type { EmailSender } from "../email/emailSender.js"
import { redeemPasswordToken } from "../domain/auth/passwordCredential.js"
import { latestPublishedApkUrl } from "../release/releaseFeed.js"
import { createApplication } from "../runtime/application.js"
import { registerPasswordRoutes, type PasswordRoutesDeps } from "./passwordRoutes.js"

vi.mock("../domain/auth/passwordCredential.js", () => ({
  redeemPasswordToken: vi.fn(),
  changePassword: vi.fn(),
  issuePasswordToken: vi.fn(),
}))
vi.mock("../release/releaseFeed.js", () => ({ latestPublishedApkUrl: vi.fn() }))

let app: FastifyInstance | undefined
const send = vi.fn<EmailSender["send"]>()
const apkUrl = "https://app.beonedge.in/downloads/client/boe.prod.client.1.0.0.apk"
const payload = { token: "opaque-reset-token-1234", newPassword: "new password with enough length" }

const buildApp = (commitFails = false): FastifyInstance => createApplication({
  logger: false,
  registerRoutes: (instance) => registerPasswordRoutes(instance, {
    unitOfWork: {
      execute: async (work: (tx: unknown) => Promise<unknown>) => {
        const outcome = await work({})
        if (commitFails) throw new Error("transaction failed")
        return outcome
      },
    },
    emailSender: { send },
    appUpdate: { releaseRoot: "/apk", downloadBaseUrl: "https://app.beonedge.in/downloads" },
    config: {},
  } as unknown as PasswordRoutesDeps),
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(redeemPasswordToken).mockResolvedValue({ kind: "redeemed", userId: "user-1", purpose: "reset", email: "client@example.com" })
  vi.mocked(latestPublishedApkUrl).mockResolvedValue(apkUrl)
  send.mockResolvedValue({ messageId: "message-1" })
})
afterEach(async () => { await app?.close() })

test("sends the configured client APK only after password redemption commits", async () => {
  app = buildApp()
  const response = await app.inject({ method: "POST", url: "/v1/auth/password/reset", payload })
  expect(response.statusCode).toBe(200)
  expect(response.json<{ data: unknown }>().data).toEqual({ status: "password_set", downloadEmailStatus: "sent", downloadUrl: apkUrl })
  expect(send).toHaveBeenCalledOnce()
  expect(send.mock.calls[0]?.[0].to).toBe("client@example.com")
  expect(send.mock.calls[0]?.[0].text).toContain(apkUrl)
  expect(send.mock.calls[0]?.[0].text).not.toContain(payload.newPassword)
  expect(send.mock.calls[0]?.[0].text).not.toContain(payload.token)
})

test("does not send an email for an invalid or replayed reset token", async () => {
  vi.mocked(redeemPasswordToken).mockResolvedValue({ kind: "unknown_token" })
  app = buildApp()
  const response = await app.inject({ method: "POST", url: "/v1/auth/password/reset", payload })
  expect(response.statusCode).toBe(401)
  expect(send).not.toHaveBeenCalled()
})

test("does not send a password confirmation when the credential transaction rolls back", async () => {
  app = buildApp(true)
  const response = await app.inject({ method: "POST", url: "/v1/auth/password/reset", payload })
  expect(response.statusCode).toBe(500)
  expect(send).not.toHaveBeenCalled()
})

test("keeps the reset successful and reports mail failure without telling the user to reuse the token", async () => {
  send.mockRejectedValue(new Error("SMTP unavailable"))
  app = buildApp()
  const response = await app.inject({ method: "POST", url: "/v1/auth/password/reset", payload })
  expect(response.statusCode).toBe(200)
  expect(response.json<{ data: unknown }>().data).toEqual({ status: "password_set", downloadEmailStatus: "unconfirmed", downloadUrl: apkUrl })
})

test("does not claim a download email was sent when no client APK is published", async () => {
  vi.mocked(latestPublishedApkUrl).mockResolvedValue(null)
  app = buildApp()
  const response = await app.inject({ method: "POST", url: "/v1/auth/password/reset", payload })
  expect(response.statusCode).toBe(200)
  expect(response.json<{ data: unknown }>().data).toEqual({ status: "password_set", downloadEmailStatus: "unavailable", downloadUrl: null })
  expect(send).not.toHaveBeenCalled()
})

test("returns a successful reset with an unconfirmed email before a stalled SMTP send reaches the HTTP timeout", async () => {
  send.mockReturnValue(new Promise(() => {}))
  app = buildApp()
  await app.ready()
  const responsePromise = app.inject({ method: "POST", url: "/v1/auth/password/reset", payload })
  const response = await responsePromise
  expect(response.statusCode).toBe(200)
  expect(response.json<{ data: unknown }>().data).toEqual({ status: "password_set", downloadEmailStatus: "unconfirmed", downloadUrl: apkUrl })
}, 10_000)
