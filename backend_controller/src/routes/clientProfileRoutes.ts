import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import {
  changeClientPhone,
  readClientProfile,
  type ClientProfile,
  type ContactDetailsDeps,
} from "../domain/client/contactDetails.js"
import { normalizePhone } from "../domain/shared/phoneNumber.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"

const PROFILE_ROUTE = "/v1/client/profile"
const PHONE_ROUTE = "/v1/client/profile/phone"

export interface ClientProfileDeps extends ContactDetailsDeps, ClientRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
}

const phoneBodySchema = z
  .object({ phone: z.string().trim().min(8).max(32), currentPassword: passwordInputSchema })
  .strict()

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
  const profile = await deps.unitOfWork.execute((tx) => readClientProfile(tx, deps, principal.userId))
  return reply.sendData(profileBody(profile), { status: 200 })
}

const changePhone = async (deps: ClientProfileDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(phoneBodySchema, request.body)
  const phoneE164 = normalizePhone(body.phone)

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

export const registerClientProfileRoutes = (application: FastifyInstance, deps: ClientProfileDeps): void => {
  application.get(PROFILE_ROUTE, (request, reply) => getProfile(deps, request, reply))
  application.post(PHONE_ROUTE, (request, reply) => changePhone(deps, request, reply))
}
