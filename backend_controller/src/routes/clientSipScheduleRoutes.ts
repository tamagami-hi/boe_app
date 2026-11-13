import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"

import type { Database } from "../db/types.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import type { AdminSipScheduleRepository } from "../repositories/adminSipScheduleRepository.js"
import { mapClientSipSchedule } from "./sipScheduleProjection.js"

const CLIENT_SIP_SCHEDULES_ROUTE = "/v1/client/sip-schedules"

export interface ClientSipScheduleDeps extends ClientRequestAuthDeps {
  readonly sipScheduleRepository: AdminSipScheduleRepository
  readonly database: Kysely<Database>
  readonly clock: () => Date
}

const listSchedules = async (deps: ClientSipScheduleDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const rows = await deps.sipScheduleRepository.listByUser(deps.database, principal.userId)
  const now = deps.clock()
  return reply.sendData({ items: rows.map((row) => mapClientSipSchedule(row, now)) }, { status: 200 })
}

export const registerClientSipScheduleRoutes = (application: FastifyInstance, deps: ClientSipScheduleDeps): void => {
  application.get(CLIENT_SIP_SCHEDULES_ROUTE, async (request, reply) => listSchedules(deps, request, reply))
}
