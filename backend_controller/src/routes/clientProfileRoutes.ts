import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import {
  confirmEmailChange,
  readPendingEmailChange,
  requestEmailChange,
  type EmailChangeDeps,
  type PendingEmailChange,
} from "../domain/client/emailChange.js"
import {
  changeClientPhone,
  readClientProfile,
  type ClientProfile,
  type ContactDetailsDeps,
} from "../domain/client/contactDetails.js"
import { normalizePhone } from "../domain/shared/phoneNumber.js"
import type { EmailVerificationRepository } from "../repositories/emailVerificationRepository.js"
import { AppError } from "../http/errorCatalog.js"
import type { FixedWindowRateLimiter } from "../http/rateLimit.js"
import { parseOrThrow } from "../http/validation.js"

const PROFILE_ROUTE = "/v1/client/profile"
const PHONE_ROUTE = "/v1/client/profile/phone"
const EMAIL_ROUTE = "/v1/client/profile/email"
const EMAIL_CONFIRM_ROUTE = "/v1/client/profile/email/confirm"

export type ClientProfileDeps = Omit<ContactDetailsDeps, "config" | "emailVerificationRepository"> &
  Omit<EmailChangeDeps, "config" | "emailVerificationRepository"> &
  ClientRequestAuthDeps & {
    readonly unitOfWork: UnitOfWork
    readonly passwordRecheckLimiter: FixedWindowRateLimiter
    readonly emailVerificationRepository: Pick<EmailVerificationRepository, "findLatestByUser" | "consumeActiveCode">
    readonly config: ContactDetailsDeps["config"] & EmailChangeDeps["config"]
  }

const phoneBodySchema = z
  .object({ phone: z.string().trim().min(8).max(32), currentPassword: passwordInputSchema })
  .strict()

const emailBodySchema = z
  .object({ newEmail: z.string().trim().email().max(254), currentPassword: passwordInputSchema })
  .strict()

const confirmBodySchema = z.object({ code: z.string().trim().min(6).max(6) }).strict()

const pendingBody = (pending: PendingEmailChange | null) =>
  pending === null ? null : { email: pending.maskedEmail, expiresAt: pending.expiresAt.toISOString() }

const profileBody = (profile: ClientProfile) => ({
  userId: profile.userId,
  fullName: profile.fullName,
  email: profile.email,
  emailVerification: profile.emailVerification,
  phone: profile.phone,
  phoneVerified: profile.phoneVerified,
  version: Number(profile.version),
})

const getProfile = async (deps: ClientProfileDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const { profile, pending } = await deps.unitOfWork.execute(async (tx) => ({
    profile: await readClientProfile(tx, deps, principal.userId),
    pending: await readPendingEmailChange(tx, deps, principal.userId),
  }))
  return reply.sendData({ ...profileBody(profile), pendingEmailChange: pendingBody(pending) }, { status: 200 })
}

const changePhone = async (deps: ClientProfileDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(phoneBodySchema, request.body)
  const phoneE164 = normalizePhone(body.phone)
  deps.passwordRecheckLimiter.hit(principal.userId)

  const outcome = await deps.unitOfWork.execute((tx) =>
    changeClientPhone(tx, deps, {
      userId: principal.userId,
      phoneE164,
      currentPassword: body.currentPassword,
      requestId: request.requestId,
    }),
  )

  if (outcome.kind === "incorrect_password") throw new AppError("INVALID_CREDENTIALS")
  if (outcome.kind === "phone_taken") {
    throw new AppError("STATE_CONFLICT", {
      message: "That phone number is already used by another account or a pending application.",
    })
  }
  return reply.sendData(
    { status: outcome.kind, profile: profileBody(outcome.profile) },
    { status: 200 },
  )
}

const changeEmail = async (deps: ClientProfileDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(emailBodySchema, request.body)
  deps.passwordRecheckLimiter.hit(principal.userId)
  const outcome = await deps.unitOfWork.execute((tx) =>
    requestEmailChange(tx, deps, {
      userId: principal.userId,
      newEmail: body.newEmail.toLowerCase(),
      currentPassword: body.currentPassword,
      requestId: request.requestId,
    }),
  )
  if (outcome.kind === "incorrect_password") throw new AppError("INVALID_CREDENTIALS")
  if (outcome.kind === "email_taken") {
    throw new AppError("STATE_CONFLICT", {
      message: "That email address is already used by another account or a pending application.",
    })
  }
  if (outcome.kind === "unchanged") return reply.sendData({ status: "unchanged", email: null, expiresAt: null }, { status: 200 })
  return reply.sendData(
    { status: "code_sent", email: outcome.maskedEmail, expiresAt: outcome.expiresAt.toISOString() },
    { status: 200 },
  )
}

const CONFIRM_REFUSALS: Readonly<Record<string, string>> = {
  no_request: "There is no email change waiting to be confirmed. Ask for a new code.",
  locked: "Too many wrong codes. Ask for a new code.",
  stale: "Your account changed since you asked. Ask for a new code.",
  email_taken: "That email address is now used by another account or a pending application.",
}

const confirmEmail = async (deps: ClientProfileDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(confirmBodySchema, request.body)
  const outcome = await deps.unitOfWork.execute((tx) =>
    confirmEmailChange(tx, deps, { userId: principal.userId, code: body.code, requestId: request.requestId }),
  )
  if (outcome.kind === "changed") return reply.sendData({ status: "changed", email: outcome.email }, { status: 200 })
  if (outcome.kind === "invalid") throw new AppError("TOKEN_INVALID")
  if (outcome.kind === "expired") throw new AppError("TOKEN_EXPIRED")
  throw new AppError("STATE_CONFLICT", { message: CONFIRM_REFUSALS[outcome.kind] ?? "Ask for a new code." })
}

export const registerClientProfileRoutes = (application: FastifyInstance, deps: ClientProfileDeps): void => {
  application.get(PROFILE_ROUTE, (request, reply) => getProfile(deps, request, reply))
  application.post(PHONE_ROUTE, (request, reply) => changePhone(deps, request, reply))
  application.post(EMAIL_ROUTE, (request, reply) => changeEmail(deps, request, reply))
  application.post(EMAIL_CONFIRM_ROUTE, (request, reply) => confirmEmail(deps, request, reply))
}
