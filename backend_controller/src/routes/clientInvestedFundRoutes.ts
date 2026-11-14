import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Database } from "../db/types.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { ClientInvestedFundRepository, ClientInvestedFundRow } from "../repositories/clientInvestedFundRepository.js"

const INVESTED_FUNDS_ROUTE = "/v1/client/invested-funds"
const INVESTED_FUND_ROUTE = "/v1/client/invested-funds/:fundId"

export interface ClientInvestedFundDeps extends ClientRequestAuthDeps {
  readonly clientInvestedFundRepository: ClientInvestedFundRepository
  readonly database: Kysely<Database>
}

const fundIdSchema = z.string().uuid()

const mapInvestedFund = (row: ClientInvestedFundRow): Record<string, unknown> => ({
  fundId: row.fundId,
  fundName: row.fundName,
  fundPublished: row.fundPublished,
})

const listInvestedFunds = async (deps: ClientInvestedFundDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const rows = await deps.clientInvestedFundRepository.listByUser(deps.database, principal.userId)
  return reply.sendData({ items: rows.map(mapInvestedFund) }, { status: 200 })
}

const getInvestedFund = async (deps: ClientInvestedFundDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const fundId = parseOrThrow(fundIdSchema, (request.params as { fundId?: unknown }).fundId)
  const row = await deps.clientInvestedFundRepository.findByUser(deps.database, { userId: principal.userId, fundId })
  if (row === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData({ investedFund: mapInvestedFund(row) }, { status: 200 })
}

export const registerClientInvestedFundRoutes = (application: FastifyInstance, deps: ClientInvestedFundDeps): void => {
  application.get(INVESTED_FUNDS_ROUTE, async (request, reply) => listInvestedFunds(deps, request, reply))
  application.get(INVESTED_FUND_ROUTE, async (request, reply) => getInvestedFund(deps, request, reply))
}
