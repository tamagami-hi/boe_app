/**
 * Client KYC routes (email-OTP; decisions 8-10). Native bearer transport.
 *
 *   POST /v1/client/kyc/start    issue a verification code (emailed from the company mailbox)
 *   POST /v1/client/kyc/resend   re-issue the code (cooldown-guarded)
 *   POST /v1/client/kyc/verify   submit the code -> KYC approved -> client becomes eligible
 *
 * The code is emailed AFTER the DB transaction commits (never during it), and is
 * never included in any HTTP response.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { CryptoContext } from "../crypto/context.js"
import type { UnitOfWork } from "../db/database.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import { requestKycCode, verifyKyc, type KycConfig } from "../domain/client/kyc.js"
import type { EmailSender } from "../email/emailSender.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { KycWriteRepository } from "../repositories/kycRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"

export interface ClientKycDeps extends NativeRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly crypto: CryptoContext
  readonly kycRepository: KycWriteRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly emailSender: EmailSender
  readonly config: KycConfig
}

const verifyBodySchema = z.object({ code: z.string().regex(/^[0-9]{6}$/u) }).strict()

const domainDeps = (deps: ClientKycDeps) => ({
  kycRepository: deps.kycRepository,
  userRepository: deps.userRepository,
  auditRepository: deps.auditRepository,
  crypto: deps.crypto,
  clock: deps.clock,
  config: deps.config,
})

const issueCode = async (deps: ClientKycDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const result = await deps.unitOfWork.execute((tx) =>
    requestKycCode(tx, domainDeps(deps), { userId: principal.userId, requestId: request.requestId }),
  )

  if (!result.alreadyApproved && result.rawCode !== null) {
    const minutes = Math.round(deps.config.codeTtlMs / 60_000)
    try {
      // Sent after commit; the raw code is never returned in the response.
      await deps.emailSender.send({
        to: result.email,
        subject: "Your BeOnEdge verification code",
        text:
          `Your BeOnEdge verification code is ${result.rawCode}.\n` +
          `It expires in ${minutes} minutes. If you did not request this, ignore this email.`,
      })
    } catch {
      throw new AppError("DEPENDENCY_UNAVAILABLE")
    }
  }

  return reply.sendData(
    {
      status: result.alreadyApproved ? "approved" : "code_sent",
      ...(result.expiresAt === null ? {} : { expiresAt: result.expiresAt }),
    },
    { status: 200 },
  )
}

const postVerify = async (deps: ClientKycDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const body = parseOrThrow(verifyBodySchema, request.body)
  const outcome = await deps.unitOfWork.execute((tx) =>
    verifyKyc(tx, domainDeps(deps), { userId: principal.userId, code: body.code, requestId: request.requestId }),
  )

  if (outcome.kind === "approved" || outcome.kind === "already_approved") {
    const kycCase = outcome.kycCase
    return reply.sendData(
      {
        status: "approved",
        kycState: kycCase.state,
        expiresAt: kycCase.expires_at === null ? null : new Date(kycCase.expires_at).toISOString(),
      },
      { status: 200 },
    )
  }
  // A failed attempt's increment has already committed; map the outcome to a wire error.
  if (outcome.kind === "expired") throw new AppError("TOKEN_EXPIRED")
  if (outcome.kind === "no_code" || outcome.kind === "invalid") throw new AppError("TOKEN_INVALID")
  throw new AppError("STATE_CONFLICT") // no_active_case | locked
}

export const registerClientKycRoutes = (application: FastifyInstance, deps: ClientKycDeps): void => {
  application.post("/v1/client/kyc/start", async (request, reply) => issueCode(deps, request, reply))
  application.post("/v1/client/kyc/resend", async (request, reply) => issueCode(deps, request, reply))
  application.post("/v1/client/kyc/verify", async (request, reply) => postVerify(deps, request, reply))
}
