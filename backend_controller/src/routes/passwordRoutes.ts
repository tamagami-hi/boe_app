import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { passwordInputSchema, verifyDummyPassword } from "../auth/passwordHasher.js"
import type { CryptoContext } from "../crypto/context.js"
import type { UnitOfWork } from "../db/database.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import {
  changePassword,
  redeemPasswordToken,
  type RedeemPasswordTokenOutcome,
} from "../domain/auth/passwordCredential.js"
import {
  issuePasswordLinkMail,
  queueAppDownloadMail,
  type AppDownloadMailOutcome,
  type PasswordLinkMailConfig,
  type PasswordLinkMailDeps,
} from "../domain/auth/passwordLinkMail.js"
import { describePasswordLinkProblem, resolvePasswordLinkBase } from "../domain/auth/passwordLinkUrl.js"
import { latestPublishedApkUrl, type ReleaseFeed } from "../release/releaseFeed.js"
import { AppError } from "../http/errorCatalog.js"
import type { FixedWindowRateLimiter } from "../http/rateLimit.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { AuthSessionWriteRepository } from "../repositories/authSessionRepository.js"
import type { CredentialWriteRepository } from "../repositories/credentialRepository.js"
import type { EmailDeliveryWriteRepository } from "../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../repositories/outboxRepository.js"
import type { PasswordTokenRepository } from "../repositories/passwordTokenRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"

export type PasswordRoutesConfig = PasswordLinkMailConfig

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
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly passwordRecheckLimiter: FixedWindowRateLimiter
  readonly config: PasswordRoutesConfig
}

const forgotBodySchema = z.object({ email: z.string().trim().email().max(254) }).strict()

const resetBodySchema = z
  .object({ token: z.string().min(16).max(512), newPassword: passwordInputSchema })
  .strict()

const changeBodySchema = z
  .object({ currentPassword: passwordInputSchema, newPassword: passwordInputSchema })
  .strict()

const domainDeps = (deps: PasswordRoutesDeps): PasswordLinkMailDeps => ({
  passwordTokenRepository: deps.passwordTokenRepository,
  credentialRepository: deps.credentialRepository,
  authSessionRepository: deps.authSessionRepository,
  userRepository: deps.userRepository,
  auditRepository: deps.auditRepository,
  outboxRepository: deps.outboxRepository,
  emailDeliveryRepository: deps.emailDeliveryRepository,
  crypto: deps.crypto,
  clock: deps.clock,
  config: deps.config,
})

const forgot = async (deps: PasswordRoutesDeps, request: FastifyRequest, reply: FastifyReply) => {
  const body = parseOrThrow(forgotBodySchema, request.body)
  const emailNormalized = body.email.toLowerCase()
  const linkBase = resolvePasswordLinkBase(deps.config.passwordLinks)

  if (linkBase.kind === "unusable") {
    request.log.error(
      { requestId: request.requestId },
      `password reset requested but ${describePasswordLinkProblem(linkBase.problem)}; no link was issued`,
    )
  } else {
    await deps.unitOfWork.execute(async (tx) => {
      const identity = await deps.userRepository.findLoginIdentityByEmail(tx, emailNormalized)
      if (identity === null) return
      try {
        await issuePasswordLinkMail(tx, domainDeps(deps), {
          userId: identity.user.id,
          requestId: request.requestId,
          requester: { kind: "user", userId: identity.user.id },
          linkBase: linkBase.base,
        })
      } catch (error) {
        if (error instanceof AppError && (error.code === "RATE_LIMITED" || error.code === "ACCOUNT_NOT_ACTIVE")) {
          return
        }
        throw error
      }
    })
  }

  await verifyDummyPassword(emailNormalized)
  return reply.sendData({ status: "accepted" }, { status: 202 })
}

type DownloadLookup =
  | { readonly kind: "found"; readonly url: string }
  | { readonly kind: "none" }
  | { readonly kind: "failed" }

const lookupDownload = async (deps: PasswordRoutesDeps): Promise<DownloadLookup> => {
  try {
    const url = await latestPublishedApkUrl(deps.appUpdate, "client")
    return url === null ? { kind: "none" } : { kind: "found", url }
  } catch {
    return { kind: "failed" }
  }
}

interface Redemption {
  readonly outcome: RedeemPasswordTokenOutcome
  readonly download: DownloadLookup
  readonly mail: AppDownloadMailOutcome | null
}

const redeem = (deps: PasswordRoutesDeps, request: FastifyRequest, body: z.infer<typeof resetBodySchema>) =>
  deps.unitOfWork.execute(async (tx): Promise<Redemption> => {
    const outcome = await redeemPasswordToken(tx, domainDeps(deps), {
      rawToken: body.token,
      newPassword: body.newPassword,
      requestId: request.requestId,
    })
    if (outcome.kind !== "redeemed") return { outcome, download: { kind: "none" }, mail: null }

    const download = await lookupDownload(deps)
    if (download.kind !== "found") return { outcome, download, mail: null }
    const mail = await queueAppDownloadMail(tx, domainDeps(deps), {
      tokenId: outcome.tokenId,
      userId: outcome.userId,
      email: outcome.email,
      downloadUrl: download.url,
      requestId: request.requestId,
    })
    return { outcome, download, mail }
  })

const downloadReport = (download: DownloadLookup, mail: AppDownloadMailOutcome | null) => {
  if (download.kind === "none") return { downloadEmailStatus: "unavailable" as const, downloadUrl: null }
  if (download.kind === "failed") return { downloadEmailStatus: "unconfirmed" as const, downloadUrl: null }
  return {
    downloadEmailStatus: mail?.kind === "queued" ? ("queued" as const) : ("unconfirmed" as const),
    downloadUrl: download.url,
  }
}

const reset = async (deps: PasswordRoutesDeps, request: FastifyRequest, reply: FastifyReply) => {
  const body = parseOrThrow(resetBodySchema, request.body)
  const { outcome, download, mail } = await redeem(deps, request, body)

  if (outcome.kind !== "redeemed") throw new AppError("INVALID_CREDENTIALS")
  if (download.kind === "none") {
    request.log.warn({ requestId: request.requestId }, "password set but no published client APK is available")
  } else if (download.kind === "failed") {
    request.log.error({ requestId: request.requestId }, "password set but the app download link could not be resolved")
  } else if (mail?.kind === "failed") {
    request.log.error({ requestId: request.requestId }, "password set but the app download email could not be queued")
  }
  return reply.sendData({ status: "password_set", ...downloadReport(download, mail) }, { status: 200 })
}

const change = async (deps: PasswordRoutesDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(changeBodySchema, request.body)
  deps.passwordRecheckLimiter.hit(principal.userId)
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

export const registerPasswordRoutes = (
  application: FastifyInstance,
  deps: PasswordRoutesDeps,
): void => {
  application.post("/v1/auth/password/forgot", (request, reply) => forgot(deps, request, reply))
  application.post("/v1/auth/password/reset", (request, reply) => reset(deps, request, reply))
  application.post("/v1/auth/password/change", (request, reply) => change(deps, request, reply))
}
