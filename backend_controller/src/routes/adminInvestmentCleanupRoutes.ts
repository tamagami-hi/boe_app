import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, UserId } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  confirmEarlierGrowthSplit,
  type ConfirmedEarlierGrowthSplit,
  type EarlierGrowthSplitDeps,
} from "../domain/admin/earlierGrowthSplit.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { toCategorise } from "../domain/client/investmentBreakdown.js"
import { computeFilterHash } from "../http/cursor.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeysetValues } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { CategorisationClient } from "../repositories/investmentBreakdownRepository.js"
import { POSITION_READ_PERMISSIONS, POSITION_WRITE_PERMISSIONS } from "./adminClientPositionRoutes.js"
import { clientInvestmentsBody, investmentRefBody } from "./adminInvestmentProjection.js"
import {
  adminIdempotencyScope,
  hashRequest,
  iso,
  limitSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const TO_CATEGORISE_ROUTE = "/v1/admin/investments/to-categorise"
const CLIENT_INVESTMENTS_ROUTE = "/v1/admin/clients/:userId/investments"
const SPLIT_ROUTE = "/v1/admin/clients/:userId/funds/:fundId/earlier-growth-split"
const MAX_SPLIT_PARTS = 200

export interface AdminInvestmentCleanupDeps extends EarlierGrowthSplitDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly idempotencyRepository: IdempotencyRepository
  readonly clock: () => Date
  readonly config: Readonly<{ idempotencyTtlMs: number; cursorKey: Buffer }>
}

const listQuerySchema = z.object({ after: z.string().min(1).optional(), limit: limitSchema }).strict()

const refSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sip"), scheduleId: uuidParam }).strict(),
  z.object({ kind: z.literal("one_time"), allocationId: uuidParam }).strict(),
])

const splitBodySchema = z
  .object({
    cutoffEntryId: uuidParam,
    parts: z
      .array(z.object({ ref: refSchema, amountPaise: z.string().regex(/^-?(0|[1-9][0-9]{0,17})$/u) }).strict())
      .max(MAX_SPLIT_PARTS),
  })
  .strict()

interface WaitingClient extends CategorisationClient {
  readonly waitingRecordings: number
  readonly fundsNeedingSplit: number
}

const readRead = async (deps: AdminInvestmentCleanupDeps, request: FastifyRequest) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  return principal
}

const waitingClients = async (deps: AdminInvestmentCleanupDeps): Promise<readonly WaitingClient[]> =>
  deps.database
    .transaction()
    .setIsolationLevel("repeatable read")
    .execute(async (tx) => {
      const clients = await deps.investmentBreakdownRepository.listClientsWithInvestments(tx)
      const contexts = await deps.investmentBreakdownRepository.loadBreakdownContexts(tx, clients.map((client) => client.userId))
      return clients.flatMap((client): WaitingClient[] => {
        const context = contexts.get(client.userId)
        if (context === undefined) return []
        const waiting = toCategorise(context.input)
        if (waiting.recordings.length === 0 && waiting.fundsNeedingSplit.length === 0) return []
        return [{ ...client, waitingRecordings: waiting.recordings.length, fundsNeedingSplit: waiting.fundsNeedingSplit.length }]
      })
    })

const isAfter = (client: WaitingClient, after: readonly string[]): boolean => {
  const [name, userId] = after
  if (name === undefined || userId === undefined) throw new AppError("CURSOR_INVALID")
  return client.name === name ? client.userId > userId : client.name > name
}

const listToCategorise = async (deps: AdminInvestmentCleanupDeps, request: FastifyRequest, reply: FastifyReply) => {
  await readRead(deps, request)
  const query = parseOrThrow(listQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({})
  const after = readKeysetValues(deps.config.cursorKey, query.after, TO_CATEGORISE_ROUTE, filterHash, now)
  const clients = [...(await waitingClients(deps))].sort((left, right) =>
    left.name === right.name ? (left.userId < right.userId ? -1 : 1) : left.name < right.name ? -1 : 1,
  )
  const remaining = after.length === 0 ? clients : clients.filter((client) => isAfter(client, after))
  const { items, page } = paginate(
    deps.config.cursorKey,
    remaining.slice(0, query.limit + 1),
    query.limit,
    TO_CATEGORISE_ROUTE,
    filterHash,
    now,
    (client) => [client.name, client.userId],
  )
  return reply.sendData(
    {
      clientCount: clients.length,
      items: items.map((client) => ({
        userId: client.userId,
        name: client.name,
        waitingRecordings: client.waitingRecordings,
        fundsNeedingSplit: client.fundsNeedingSplit,
      })),
    },
    { status: 200, page },
  )
}

const getClientInvestments = async (deps: AdminInvestmentCleanupDeps, request: FastifyRequest, reply: FastifyReply) => {
  await readRead(deps, request)
  const userId = parseOrThrow(uuidParam, (request.params as Record<string, unknown>).userId)
  const body = await deps.database
    .transaction()
    .setIsolationLevel("repeatable read")
    .execute(async (tx) => {
      const client = await deps.userRepository.findById(tx, userId as UserId)
      if (client === null) return null
      const context = (await deps.investmentBreakdownRepository.loadBreakdownContexts(tx, [userId])).get(userId)
      if (context === undefined) return null
      const fundIds = [...new Set(context.input.entries.map((entry) => entry.fundId))]
      return clientInvestmentsBody(userId, context, await deps.investmentBreakdownRepository.fundNames(tx, fundIds))
    })
  if (body === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData(body, { status: 200 })
}

const splitBody = (split: ConfirmedEarlierGrowthSplit): Record<string, unknown> => ({
  fundId: split.fundId,
  split: {
    splitId: split.splitId,
    cutoffEntryId: split.cutoffEntryId,
    totalPaise: split.totalPaise.toString(),
    parts: split.parts.map((part) => ({ ref: investmentRefBody(part.ref), amountPaise: part.amountPaise.toString() })),
    confirmedAt: iso(split.confirmedAt),
  },
})

const confirmSplit = async (deps: AdminInvestmentCleanupDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [...POSITION_WRITE_PERMISSIONS])
  const params = request.params as Record<string, unknown>
  const userId = parseOrThrow(uuidParam, params.userId)
  const fundId = parseOrThrow(uuidParam, params.fundId)
  const body = parseOrThrow(splitBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    retention: "durable",
    scope: adminIdempotencyScope(principal.userId, SPLIT_ROUTE, key),
    requestHash: hashRequest({ userId, fundId, cutoffEntryId: body.cutoffEntryId, parts: body.parts }),
    execute: async (tx) => {
      const split = await confirmEarlierGrowthSplit(tx, deps, {
        userId,
        fundId,
        cutoffEntryId: body.cutoffEntryId,
        parts: body.parts.map((part) => ({ ref: part.ref, amountPaise: BigInt(part.amountPaise) })),
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 201, body: splitBody(split) }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

export const registerAdminInvestmentCleanupRoutes = (
  application: FastifyInstance,
  deps: AdminInvestmentCleanupDeps,
): void => {
  application.get(TO_CATEGORISE_ROUTE, (request, reply) => listToCategorise(deps, request, reply))
  application.get(CLIENT_INVESTMENTS_ROUTE, (request, reply) => getClientInvestments(deps, request, reply))
  application.post(SPLIT_ROUTE, (request, reply) => confirmSplit(deps, request, reply))
}
