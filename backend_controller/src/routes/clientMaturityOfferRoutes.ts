import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, IdempotencyScope } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { chooseMaturityOption, type MaturityChoiceDeps } from "../domain/client/maturityChoice.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent } from "../http/idempotencyProtocol.js"
import { parseOrThrow } from "../http/validation.js"
import type { MaturityOfferRow } from "../repositories/clientMaturityOfferRepository.js"
import { hashRequest, iso, isoOrNull, requireIdempotencyKey, uuidParam } from "./adminRouteKit.js"

export interface ClientMaturityOfferDeps extends ClientRequestAuthDeps, MaturityChoiceDeps {
  readonly database: Kysely<Database>
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: Readonly<{ idempotencyTtlMs: number }>
}

const OFFERS_ROUTE = "/v1/client/maturity-options"
const OFFER_ROUTE = `${OFFERS_ROUTE}/:offerId`
const CHOICE_ROUTE = `${OFFER_ROUTE}/choice`

const chooseBodySchema = z.strictObject({
  option: z.enum(["return_all", "one_time_and_sip", "sip_extension"]),
  expectedVersion: z.number().int().positive(),
})

const mapOffer = (row: MaturityOfferRow): Record<string, unknown> => ({
  offerId: row.id,
  fundId: row.fundId,
  fundName: row.fundName,
  maturityDate: row.maturityDate,
  state: row.state,
  version: Number(row.version),
  sentAt: iso(row.createdAt),
  chosenOption: row.chosenOption,
  chosenAt: isoOrNull(row.chosenAt),
  sip: { monthlyAmountPaise: row.sipMonthlyAmountPaise, startMonth: row.sipStartMonth, monthCount: row.sipMonthCount },
  extension:
    row.extensionMonths === null || row.nextMaturityDate === null
      ? null
      : { months: row.extensionMonths, nextMaturityDate: row.nextMaturityDate },
})

const offerIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as Record<string, unknown>).offerId)

const userScope = (userId: string, key: string): IdempotencyScope => ({
  actorScope: `user:${userId}`,
  actorScopeKeyVersion: null,
  candidateActorScopes: [`user:${userId}`],
  method: "POST",
  routeTemplate: CHOICE_ROUTE,
  key,
})

const listOffers = async (deps: ClientMaturityOfferDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const rows = await deps.maturityOfferRepository.listOpenForUser(deps.database, principal.userId)
  return reply.sendData({ items: rows.map(mapOffer) }, { status: 200 })
}

const getOffer = async (deps: ClientMaturityOfferDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const row = await deps.maturityOfferRepository.findForUser(deps.database, {
    userId: principal.userId,
    offerId: offerIdOf(request),
  })
  if (row === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData({ offer: mapOffer(row) }, { status: 200 })
}

const choose = async (deps: ClientMaturityOfferDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const key = requireIdempotencyKey(request)
  const offerId = offerIdOf(request)
  const body = parseOrThrow(chooseBodySchema, request.body)
  const now = deps.clock()
  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: userScope(principal.userId, key),
      requestHash: hashRequest({ offerId, ...body }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const row = await chooseMaturityOption(tx, deps, {
          userId: principal.userId,
          offerId,
          option: body.option,
          expectedVersion: body.expectedVersion,
          requestId: request.requestId,
        })
        return { status: 200, body: { offer: mapOffer(row) } }
      },
    }),
  )
  return reply.sendData(outcome.body, { status: outcome.status, ...(outcome.replay ? { idempotencyReplay: true } : {}) })
}

export const registerClientMaturityOfferRoutes = (application: FastifyInstance, deps: ClientMaturityOfferDeps): void => {
  application.get(OFFERS_ROUTE, (request, reply) => listOffers(deps, request, reply))
  application.get(OFFER_ROUTE, (request, reply) => getOffer(deps, request, reply))
  application.post(CHOICE_ROUTE, (request, reply) => choose(deps, request, reply))
}
