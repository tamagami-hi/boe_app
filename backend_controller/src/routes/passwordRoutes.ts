import { setTimeout as delay } from "node:timers/promises"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { passwordInputSchema, verifyDummyPassword } from "../auth/passwordHasher.js"
import type { CryptoContext } from "../crypto/context.js"
import type { UnitOfWork } from "../db/database.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import {
  changePassword,
  issuePasswordToken,
  redeemPasswordToken,
  type PasswordCredentialConfig,
  type PasswordCredentialDeps,
} from "../domain/auth/passwordCredential.js"
import { latestPublishedApkUrl, type ReleaseFeed } from "../release/releaseFeed.js"
import type { EmailSender } from "../email/emailSender.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { AuthSessionWriteRepository } from "../repositories/authSessionRepository.js"
import type { CredentialWriteRepository } from "../repositories/credentialRepository.js"
import type { PasswordTokenRepository } from "../repositories/passwordTokenRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"

export interface PasswordRoutesConfig extends PasswordCredentialConfig {
  readonly resetUrlBase: string | null
}

export interface PasswordRoutesDeps extends ClientRequestAuthDeps {
  readonly appUpdate: ReleaseFeed
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly crypto: CryptoContext
  readonly passwordTokenRepository: PasswordTokenRepository
  readonly credentialRepository: CredentialWriteRepository
  readonly authSessionRepository: AuthSessionWriteRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly emailSender: EmailSender
  readonly config: PasswordRoutesConfig
}

const forgotBodySchema = z.object({ email: z.string().trim().email().max(254) }).strict()

const resetBodySchema = z
  .object({ token: z.string().min(16).max(512), newPassword: passwordInputSchema })
  .strict()

const changeBodySchema = z
  .object({ currentPassword: passwordInputSchema, newPassword: passwordInputSchema })
  .strict()

const domainDeps = (deps: PasswordRoutesDeps): PasswordCredentialDeps => ({
  passwordTokenRepository: deps.passwordTokenRepository,
  credentialRepository: deps.credentialRepository,
  authSessionRepository: deps.authSessionRepository,
  userRepository: deps.userRepository,
  auditRepository: deps.auditRepository,
  crypto: deps.crypto,
  clock: deps.clock,
  config: deps.config,
})

export const PASSWORD_RESET_PATH = "/reset-password"

export const passwordResetUrlBase = (originAllowlist: readonly string[]): string | null => {
  const origin = originAllowlist[0]
  return origin === undefined ? null : `${origin.replace(/\/+$/u, "")}${PASSWORD_RESET_PATH}`
}

export const buildPasswordResetLink = (base: string | null, rawToken: string): string | null => {
  if (base === null) return null
  const url = new URL(base)
  url.searchParams.set("token", rawToken)
  return url.toString()
}

const resetEmailBody = (link: string, minutes: number): string =>
  [
    "Someone asked to reset the password on your BeOnEdge account.",
    "",
    "Open this link to choose a new password:",
    link,
    "",
    `The link works once and expires in ${String(minutes)} minutes.`,
    "If you did not ask for this, ignore this email — nothing has changed.",
  ].join("\n")

const inviteEmailBody = (link: string, minutes: number): string =>
  [
    "An account has been opened for you on BeOnEdge.",
    "",
    "Choose your password here:",
    link,
    "",
    `The link works once and expires in ${String(minutes)} minutes.`,
    "After signing in you will be asked to verify your email address before you",
    "can invest.",
  ].join("\n")

const forgot = async (deps: PasswordRoutesDeps, request: FastifyRequest, reply: FastifyReply) => {
  const body = parseOrThrow(forgotBodySchema, request.body)
  const emailNormalized = body.email.toLowerCase()

  const issued = await deps.unitOfWork.execute(async (tx) => {
    const identity = await deps.userRepository.findLoginIdentityByEmail(tx, emailNormalized)
    if (identity === null) return null
    try {
      return await issuePasswordToken(tx, domainDeps(deps), {
        userId: identity.user.id,
        purpose: "reset",
        requestId: request.requestId,
      })
    } catch (error) {
      if (error instanceof AppError && error.code === "RATE_LIMITED") return null
      throw error
    }
  })

  if (issued === null) {
    await verifyDummyPassword(emailNormalized)
  } else {
    const link = buildPasswordResetLink(deps.config.resetUrlBase, issued.rawToken)
    if (link === null) {
      request.log.error(
        { requestId: request.requestId },
        "password reset requested but no client web origin is configured",
      )
    } else {
      const minutes = Math.round(deps.config.tokenTtlMs / 60_000)
      try {
        await deps.emailSender.send({
          to: issued.email,
          subject: "Reset your BeOnEdge password",
          text: resetEmailBody(link, minutes),
        })
      } catch {
        request.log.error({ requestId: request.requestId }, "password reset mail could not be sent")
      }
    }
  }

  return reply.sendData({ status: "accepted" }, { status: 202 })
}

const DOWNLOAD_EMAIL_WAIT_MS = 5_000

const sendResetDownload = async (deps: PasswordRoutesDeps, request: FastifyRequest, email: string) => {
  let downloadUrl: string | null = null
  try {
    downloadUrl = await latestPublishedApkUrl(deps.appUpdate, "client")
    if (downloadUrl === null) {
      request.log.warn({ requestId: request.requestId }, "password set but no published client APK is available")
      return { downloadEmailStatus: "unavailable" as const, downloadUrl }
    }
    const controller = new AbortController()
    const accepted = await Promise.race([deps.emailSender.send({
      to: email,
      subject: "Your BeOnEdge password is set — download the app",
      text: [
        "Your BeOnEdge password has been set successfully.",
        "",
        "Download the BeOnEdge Android app using the official link below:",
        downloadUrl,
        "",
        "Download and install the app, then sign in with your email address and new password.",
        "If the app is already installed, you can sign in with your new password now.",
        "",
        "If you did not change your password, contact BeOnEdge support immediately.",
      ].join("\n"),
    }).then(() => true), delay(DOWNLOAD_EMAIL_WAIT_MS, false, { signal: controller.signal })])
      .finally(() => { controller.abort() })
    if (!accepted) {
      request.log.warn({ requestId: request.requestId }, "password set; app download email confirmation timed out")
      return { downloadEmailStatus: "unconfirmed" as const, downloadUrl }
    }
    return { downloadEmailStatus: "sent" as const, downloadUrl }
  } catch {
    request.log.error({ requestId: request.requestId }, "password set but app download email could not be sent")
    return { downloadEmailStatus: "unconfirmed" as const, downloadUrl }
  }
}

const reset = async (deps: PasswordRoutesDeps, request: FastifyRequest, reply: FastifyReply) => {
  const body = parseOrThrow(resetBodySchema, request.body)
  const outcome = await deps.unitOfWork.execute((tx) =>
    redeemPasswordToken(tx, domainDeps(deps), {
      rawToken: body.token,
      newPassword: body.newPassword,
      requestId: request.requestId,
    }),
  )

  if (outcome.kind !== "redeemed") throw new AppError("INVALID_CREDENTIALS")
  const download = await sendResetDownload(deps, request, outcome.email)
  return reply.sendData({ status: "password_set", ...download }, { status: 200 })
}

const change = async (deps: PasswordRoutesDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(changeBodySchema, request.body)
  const outcome = await deps.unitOfWork.execute((tx) =>
    changePassword(tx, domainDeps(deps), {
      userId: principal.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      requestId: request.requestId,
    }),
  )

  if (outcome.kind !== "changed") throw new AppError("INVALID_CREDENTIALS")
  return reply.sendData({ status: "password_set" }, { status: 200 })
}

export const sendPasswordInvite = async (
  deps: Pick<PasswordRoutesDeps, "emailSender" | "config">,
  issued: Readonly<{ email: string; rawToken: string }>,
): Promise<void> => {
  const link = buildPasswordResetLink(deps.config.resetUrlBase, issued.rawToken)
  if (link === null) return
  const minutes = Math.round(deps.config.tokenTtlMs / 60_000)
  await deps.emailSender.send({
    to: issued.email,
    subject: "Set your BeOnEdge password",
    text: inviteEmailBody(link, minutes),
  })
}

export const registerPasswordRoutes = (
  application: FastifyInstance,
  deps: PasswordRoutesDeps,
): void => {
  application.post("/v1/auth/password/forgot", (request, reply) => forgot(deps, request, reply))
  application.post("/v1/auth/password/reset", (request, reply) => reset(deps, request, reply))
  application.post("/v1/auth/password/change", (request, reply) => change(deps, request, reply))
}
