import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { changeOwnNominee, readNominee, type OwnNomineeDeps } from "../domain/client/nominee.js"
import { AppError } from "../http/errorCatalog.js"
import type { FixedWindowRateLimiter } from "../http/rateLimit.js"
import { parseOrThrow } from "../http/validation.js"
import { nomineeBody, nomineeFields, nomineeOf, requireBothOrNeither } from "./nomineeSchemas.js"

const NOMINEE_ROUTE = "/v1/client/profile/nominee"

export type ClientNomineeDeps = OwnNomineeDeps &
  ClientRequestAuthDeps & {
    readonly unitOfWork: UnitOfWork
    readonly passwordRecheckLimiter: FixedWindowRateLimiter
  }

const changeBodySchema = z
  .object({ ...nomineeFields, currentPassword: passwordInputSchema })
  .strict()
  .superRefine(requireBothOrNeither)

const getNominee = async (deps: ClientNomineeDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const holder = await deps.unitOfWork.execute((tx) => readNominee(tx, deps, principal.userId))
  return reply.sendData(nomineeBody(holder), { status: 200 })
}

const changeNominee = async (deps: ClientNomineeDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(changeBodySchema, request.body)
  deps.passwordRecheckLimiter.hit(principal.userId)
  const outcome = await deps.unitOfWork.execute((tx) =>
    changeOwnNominee(tx, deps, {
      userId: principal.userId,
      nominee: nomineeOf(body),
      currentPassword: body.currentPassword,
      requestId: request.requestId,
    }),
  )
  if (outcome.status === "incorrect_password") throw new AppError("INVALID_CREDENTIALS")
  return reply.sendData({ ...nomineeBody(outcome.holder), status: outcome.status }, { status: 200 })
}

export const registerClientNomineeRoutes = (application: FastifyInstance, deps: ClientNomineeDeps): void => {
  application.get(NOMINEE_ROUTE, (request, reply) => getNominee(deps, request, reply))
  application.post(NOMINEE_ROUTE, (request, reply) => changeNominee(deps, request, reply))
}
