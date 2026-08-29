import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { CryptoContext } from "../crypto/context.js"
import type { UnitOfWork } from "../db/database.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import {
  requestEmailVerificationCode,
  verifyEmail,
  type EmailVerificationConfig,
} from "../domain/client/emailVerification.js"
import type { EmailSender } from "../email/emailSender.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { EmailVerificationRepository } from "../repositories/emailVerificationRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"

export interface ClientEmailVerificationDeps extends NativeRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly crypto: CryptoContext
  readonly emailVerificationRepository: EmailVerificationRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly emailSender: EmailSender
  readonly config: EmailVerificationConfig
}

const verifyBodySchema = z.object({ code: z.string().regex(/^[A-Za-z0-9]{6}$/u) }).strict()

const domainDeps = (deps: ClientEmailVerificationDeps) => ({
  emailVerificationRepository: deps.emailVerificationRepository,
  userRepository: deps.userRepository,
  auditRepository: deps.auditRepository,
  crypto: deps.crypto,
  clock: deps.clock,
  config: deps.config,
})

const issueCode = async (deps: ClientEmailVerificationDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const result = await deps.unitOfWork.execute((tx) =>
    requestEmailVerificationCode(tx, domainDeps(deps), {
      userId: principal.userId,
      requestId: request.requestId,
    }),
  )

  if (!result.alreadyVerified && result.rawCode !== null) {
    const minutes = Math.round(deps.config.codeTtlMs / 60_000)
    try {
      await deps.emailSender.send({
        to: result.email,
        subject: "Your BeOnEdge email verification code",
        text:
          `Your BeOnEdge email verification code is ${result.rawCode}.\n` +
          `It is a 6-character, case-sensitive code that expires in ${minutes} minutes. ` +
          `If you did not request this, ignore this email.`,
      })
    } catch {
      throw new AppError("DEPENDENCY_UNAVAILABLE")
    }
  }

  return reply.sendData(
    {
      status: result.alreadyVerified ? "verified" : "code_sent",
      ...(result.expiresAt === null ? {} : { expiresAt: result.expiresAt }),
    },
    { status: 200 },
  )
}

const postVerify = async (deps: ClientEmailVerificationDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const body = parseOrThrow(verifyBodySchema, request.body)
  const outcome = await deps.unitOfWork.execute((tx) =>
    verifyEmail(tx, domainDeps(deps), {
      userId: principal.userId,
      code: body.code,
      requestId: request.requestId,
    }),
  )

  if (outcome.kind === "verified" || outcome.kind === "already_verified") {
    const verification = outcome.verification
    return reply.sendData(
      {
        status: "verified",
        emailVerificationState: verification.state,
        verifiedAt: verification.verifiedAt === null ? null : verification.verifiedAt.toISOString(),
      },
      { status: 200 },
    )
  }
  if (outcome.kind === "expired") throw new AppError("TOKEN_EXPIRED")
  if (outcome.kind === "no_code" || outcome.kind === "invalid") throw new AppError("TOKEN_INVALID")
  throw new AppError("STATE_CONFLICT")
}

const getStatus = async (deps: ClientEmailVerificationDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const verification = await deps.unitOfWork.execute((tx) =>
    deps.emailVerificationRepository.findLatestByUser(tx, principal.userId),
  )
  return reply.sendData({
    emailVerificationState: verification?.state ?? "not_started",
    method: "email_otp",
    startedAt: verification?.submittedAt === null || verification === null ? null : new Date(verification.submittedAt).toISOString(),
    verifiedAt: verification?.verifiedAt === null || verification === null ? null : new Date(verification.verifiedAt).toISOString(),
  })
}

export const registerClientEmailVerificationRoutes = (
  application: FastifyInstance,
  deps: ClientEmailVerificationDeps,
): void => {
  application.post("/v1/client/email-verification/start", async (request, reply) => issueCode(deps, request, reply))
  application.post("/v1/client/email-verification/verify", async (request, reply) => postVerify(deps, request, reply))
  application.get("/v1/client/email-verification-status", async (request, reply) => getStatus(deps, request, reply))
}
