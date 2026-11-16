import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"

import type { Database } from "../db/types.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import type { SipEarlyExitRepository } from "../repositories/earlyExitRepository.js"
import { mapClientSipEarlyExit } from "./earlyExitProjection.js"

const CLIENT_EARLY_EXITS_ROUTE = "/v1/client/sip-early-exits"

export interface ClientSipEarlyExitDeps extends ClientRequestAuthDeps {
  readonly sipEarlyExitRepository: Pick<SipEarlyExitRepository, "listByUser">
  readonly database: Kysely<Database>
}

const listEarlyExits = async (deps: ClientSipEarlyExitDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const rows = await deps.sipEarlyExitRepository.listByUser(deps.database, principal.userId)
  return reply.sendData({ items: rows.map(mapClientSipEarlyExit) }, { status: 200 })
}

export const registerClientSipEarlyExitRoutes = (application: FastifyInstance, deps: ClientSipEarlyExitDeps): void => {
  application.get(CLIENT_EARLY_EXITS_ROUTE, async (request, reply) => listEarlyExits(deps, request, reply))
}
