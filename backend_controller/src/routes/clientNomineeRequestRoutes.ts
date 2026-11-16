import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, IdempotencyScope, Transaction } from "../db/repositories.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import {
  readLatestNomineeRequest,
  sendNomineeRequest,
  withdrawNomineeRequest,
  type SendNomineeRequestDeps,
} from "../domain/client/nomineeRequests.js"
import type { FixedWindowRateLimiter } from "../http/rateLimit.js"
import { executeIdempotent, receiptExpiresAt } from "../http/idempotencyProtocol.js"
import { parseOrThrow } from "../http/validation.js"
import type { NomineeRequestRow } from "../repositories/nomineeRequestRepository.js"
import { hashRequest, iso, isoOrNull, requireIdempotencyKey, uuidParam } from "./adminRouteKit.js"
import { requestedNomineeFields } from "./nomineeSchemas.js"

const REQUESTS_ROUTE = "/v1/client/nominee-requests"
const LATEST_ROUTE = `${REQUESTS_ROUTE}/latest`
const WITHDRAW_ROUTE = `${REQUESTS_ROUTE}/:requestId/withdraw`

export type ClientNomineeRequestDeps = SendNomineeRequestDeps &
  ClientRequestAuthDeps & {
    readonly unitOfWork: UnitOfWork
    readonly idempotencyRepository: IdempotencyRepository
    readonly passwordRecheckLimiter: FixedWindowRateLimiter
    readonly config: Readonly<{ idempotencyTtlMs: number }>
  }

const sendBodySchema = z.object({ ...requestedNomineeFields, currentPassword: passwordInputSchema }).strict()

const withdrawBodySchema = z.object({ expectedVersion: z.number().int().positive() }).strict()

export const clientNomineeRequestBody = (row: NomineeRequestRow) => ({
  id: row.id,
  nominee: { name: row.nomineeName, relation: row.nomineeRelation },
  state: row.state,
  declineReason: row.declineReason,
  createdAt: iso(row.createdAt),
  decidedAt: isoOrNull(row.decidedAt),
  version: Number(row.version),
})

const userScope = (userId: string, routeTemplate: string, key: string): IdempotencyScope => ({
  actorScope: `user:${userId}`,
  actorScopeKeyVersion: null,
  candidateActorScopes: [`user:${userId}`],
  method: "POST",
  routeTemplate,
  key,
})

const runClientWrite = (
  deps: ClientNomineeRequestDeps,
  scope: IdempotencyScope,
  requestHash: Buffer,
  execute: (tx: Transaction) => Promise<{ readonly status: number; readonly body: Record<string, unknown> }>,
) => {
  const now = deps.clock()
  return deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope,
      requestHash,
      now: now.toISOString(),
      expiresAt: receiptExpiresAt("ordinary", now, deps.config.idempotencyTtlMs),
      execute: () => execute(tx),
    }),
  )
}

const getLatest = async (deps: ClientNomineeRequestDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const row = await deps.unitOfWork.execute((tx) => readLatestNomineeRequest(tx, deps, principal.userId))
  return reply.sendData({ request: row === null ? null : clientNomineeRequestBody(row) }, { status: 200 })
}

const send = async (deps: ClientNomineeRequestDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(sendBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  deps.passwordRecheckLimiter.hit(principal.userId)
  const nominee = { name: body.name, relation: body.relation }
  const outcome = await runClientWrite(deps, userScope(principal.userId, REQUESTS_ROUTE, key), hashRequest(nominee), async (tx) => {
    const created = await sendNomineeRequest(tx, deps, {
      userId: principal.userId,
      nominee,
      currentPassword: body.currentPassword,
      requestId: request.requestId,
    })
    return { status: 201, body: { request: clientNomineeRequestBody(created) } }
  })
  return reply.sendData(outcome.body, { status: outcome.status, ...(outcome.replay ? { idempotencyReplay: true } : {}) })
}

const withdraw = async (deps: ClientNomineeRequestDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const nomineeRequestId = parseOrThrow(uuidParam, (request.params as Record<string, unknown>).requestId)
  const body = parseOrThrow(withdrawBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const scope = userScope(principal.userId, WITHDRAW_ROUTE, key)
  const outcome = await runClientWrite(deps, scope, hashRequest({ nomineeRequestId, ...body }), async (tx) => {
    const closed = await withdrawNomineeRequest(tx, deps, {
      userId: principal.userId,
      nomineeRequestId,
      expectedVersion: body.expectedVersion,
      requestId: request.requestId,
    })
    return { status: 200, body: { request: clientNomineeRequestBody(closed) } }
  })
  return reply.sendData(outcome.body, { status: outcome.status, ...(outcome.replay ? { idempotencyReplay: true } : {}) })
}

export const registerClientNomineeRequestRoutes = (application: FastifyInstance, deps: ClientNomineeRequestDeps): void => {
  application.get(LATEST_ROUTE, (request, reply) => getLatest(deps, request, reply))
  application.post(REQUESTS_ROUTE, (request, reply) => send(deps, request, reply))
  application.post(WITHDRAW_ROUTE, (request, reply) => withdraw(deps, request, reply))
}
