import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

import type { UnitOfWork } from "../db/database.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { readNominee, type NomineeDeps } from "../domain/client/nominee.js"
import { AppError } from "../http/errorCatalog.js"
import { nomineeBody } from "./nomineeSchemas.js"

const NOMINEE_ROUTE = "/v1/client/profile/nominee"

export const DIRECT_CHANGE_REFUSED_MESSAGE =
  "Nominee changes are now sent to the BeOnEdge team as a request. Update the app to send one."

export type ClientNomineeDeps = Pick<NomineeDeps, "userNomineeRepository"> &
  ClientRequestAuthDeps & {
    readonly unitOfWork: UnitOfWork
  }

const getNominee = async (deps: ClientNomineeDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const holder = await deps.unitOfWork.execute((tx) => readNominee(tx, deps, principal.userId))
  return reply.sendData(nomineeBody(holder), { status: 200 })
}

const refuseDirectChange = async (deps: ClientNomineeDeps, request: FastifyRequest): Promise<never> => {
  await resolveClientPrincipal(request, deps)
  throw new AppError("AUTHORIZATION_DENIED", { message: DIRECT_CHANGE_REFUSED_MESSAGE })
}

export const registerClientNomineeRoutes = (application: FastifyInstance, deps: ClientNomineeDeps): void => {
  application.get(NOMINEE_ROUTE, (request, reply) => getNominee(deps, request, reply))
  application.post(NOMINEE_ROUTE, (request) => refuseDirectChange(deps, request))
}
