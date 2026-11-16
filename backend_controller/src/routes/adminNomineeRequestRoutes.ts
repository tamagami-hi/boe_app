import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, Transaction } from "../db/repositories.js"
import type { NomineeRequestState } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  acceptNomineeRequest,
  declineNomineeRequest,
  type NomineeDecision,
  type NomineeDecisionDeps,
} from "../domain/admin/nomineeRequestDecisions.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { createdAtKeyset, paginate, readKeyset, readKeysetValues } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { AdminNomineeRequestRow, QueuedNomineeRequestRow, QueuePosition } from "../repositories/nomineeRequestRepository.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  isoOrNull,
  limitSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"
import { clientNomineeRequestBody } from "./clientNomineeRequestRoutes.js"
import { declineReasonSchema, nomineeBody } from "./nomineeSchemas.js"

const QUEUE_ROUTE = "/v1/admin/nominee-requests"
const SUMMARY_ROUTE = "/v1/admin/overview/nominee-requests"
const ACCEPT_ROUTE = `${QUEUE_ROUTE}/:requestId/accept`
const DECLINE_ROUTE = `${QUEUE_ROUTE}/:requestId/decline`
const USER_REQUESTS_ROUTE = "/v1/admin/users/:userId/nominee-requests"
const READ_PERMISSIONS = ["users.read"] as const
const WRITE_PERMISSIONS = ["clients.create"] as const

const STATES = ["pending", "accepted", "declined", "withdrawn"] as const satisfies readonly NomineeRequestState[]
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/u
const CURSOR_RANK = /^[01]$/u

export interface AdminNomineeRequestDeps extends NomineeDecisionDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: Readonly<{ cursorKey: Buffer; idempotencyTtlMs: number; sesConfigurationSet: string }>
}

const pageQuery = { after: z.string().min(1).optional(), limit: limitSchema }

const queueQuerySchema = z.object({ ...pageQuery, state: z.enum(STATES).optional() }).strict()

const userQuerySchema = z.object(pageQuery).strict()

const acceptBodySchema = z
  .object({ expectedVersion: z.number().int().positive(), expectedNomineeVersion: z.number().int().nonnegative() })
  .strict()

const declineBodySchema = z
  .object({ expectedVersion: z.number().int().positive(), reason: declineReasonSchema.nullable() })
  .strict()

const adminRequestBody = (row: AdminNomineeRequestRow) => ({
  ...clientNomineeRequestBody(row),
  userId: row.userId,
  clientName: row.clientName,
  decidedByName: row.decidedByName,
})

const decisionBody = (decision: NomineeDecision, row: AdminNomineeRequestRow | null) => {
  if (row === null) throw new AppError("INTERNAL_ERROR")
  return { request: adminRequestBody(row), nominee: nomineeBody(decision.holder) }
}

const paramOf = (request: FastifyRequest, name: "requestId" | "userId"): string =>
  parseOrThrow(uuidParam, (request.params as Record<string, unknown> | undefined)?.[name])

const readQueuePosition = (
  deps: AdminNomineeRequestDeps,
  after: string | undefined,
  filterHash: string,
  now: Date,
): QueuePosition => {
  const values = readKeysetValues(deps.config.cursorKey, after, QUEUE_ROUTE, filterHash, now)
  if (values.length === 0) return { asOf: now }
  const [asOf, afterRank, afterCreatedAt, afterId] = values
  if (
    asOf === undefined ||
    afterRank === undefined ||
    afterCreatedAt === undefined ||
    afterId === undefined ||
    !CURSOR_TIME.test(asOf) ||
    !CURSOR_RANK.test(afterRank) ||
    !CURSOR_TIME.test(afterCreatedAt) ||
    !uuidParam.safeParse(afterId).success
  ) {
    throw new AppError("CURSOR_INVALID")
  }
  return { asOf: new Date(asOf), afterRank, afterCreatedAt, afterId }
}

const queueKeyset =
  (asOf: Date) =>
  (row: QueuedNomineeRequestRow): readonly string[] => [asOf.toISOString(), row.queueRank, row.cursorAt, row.id]

const listQueue = async (deps: AdminNomineeRequestDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, READ_PERMISSIONS)
  const query = parseOrThrow(queueQuerySchema, request.query ?? {})
  const now = deps.clock()
  const filterHash = computeFilterHash({ state: query.state ?? null })
  const position = readQueuePosition(deps, query.after, filterHash, now)
  const rows = await deps.unitOfWork.execute((tx) =>
    deps.nomineeRequestRepository.listQueue(tx, {
      ...position,
      ...(query.state === undefined ? {} : { state: query.state }),
      limit: query.limit + 1,
    }),
  )
  const { items, page } = paginate(deps.config.cursorKey, rows, query.limit, QUEUE_ROUTE, filterHash, now, queueKeyset(position.asOf))
  return reply.sendData({ items: items.map(adminRequestBody) }, { status: 200, page })
}

const getSummary = async (deps: AdminNomineeRequestDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, READ_PERMISSIONS)
  const summary = await deps.unitOfWork.execute((tx) => deps.nomineeRequestRepository.summarizePending(tx))
  return reply.sendData(
    { pendingCount: summary.pendingCount, oldestPendingAt: isoOrNull(summary.oldestPendingAt) },
    { status: 200 },
  )
}

const listForUser = async (deps: AdminNomineeRequestDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, READ_PERMISSIONS)
  const userId = paramOf(request, "userId")
  const query = parseOrThrow(userQuerySchema, request.query ?? {})
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId })
  const keyset = readKeyset(deps.config.cursorKey, query.after, USER_REQUESTS_ROUTE, filterHash, now)
  const rows = await deps.unitOfWork.execute(async (tx) => {
    if (!(await deps.nomineeRequestRepository.userExists(tx, userId))) return null
    return deps.nomineeRequestRepository.listForUser(tx, { userId, ...keyset, limit: query.limit + 1 })
  })
  if (rows === null) throw new AppError("RESOURCE_NOT_FOUND")
  const { items, page } = paginate(deps.config.cursorKey, rows, query.limit, USER_REQUESTS_ROUTE, filterHash, now, createdAtKeyset)
  return reply.sendData({ items: items.map(adminRequestBody) }, { status: 200, page })
}

const authorizeDecision = async (deps: AdminNomineeRequestDeps, request: FastifyRequest) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, WRITE_PERMISSIONS)
  return { actorUserId: principal.userId, nomineeRequestId: paramOf(request, "requestId") }
}

interface DecisionWrite {
  readonly route: string
  readonly actorUserId: string
  readonly key: string
  readonly canonical: Readonly<Record<string, unknown>>
  readonly run: (tx: Transaction) => Promise<NomineeDecision>
}

const commitDecision = async (deps: AdminNomineeRequestDeps, reply: FastifyReply, write: DecisionWrite) => {
  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(write.actorUserId, write.route, write.key),
    requestHash: hashRequest(write.canonical),
    execute: async (tx) => {
      const decision = await write.run(tx)
      const row = await deps.nomineeRequestRepository.findForAdmin(tx, decision.request.id)
      return { status: 200, body: decisionBody(decision, row) }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const accept = async (deps: AdminNomineeRequestDeps, request: FastifyRequest, reply: FastifyReply) => {
  const { actorUserId, nomineeRequestId } = await authorizeDecision(deps, request)
  const body = parseOrThrow(acceptBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  return commitDecision(deps, reply, {
    route: ACCEPT_ROUTE,
    actorUserId,
    key,
    canonical: { nomineeRequestId, ...body },
    run: (tx) => acceptNomineeRequest(tx, deps, { nomineeRequestId, actorUserId, requestId: request.requestId, ...body }),
  })
}

const decline = async (deps: AdminNomineeRequestDeps, request: FastifyRequest, reply: FastifyReply) => {
  const { actorUserId, nomineeRequestId } = await authorizeDecision(deps, request)
  const body = parseOrThrow(declineBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  return commitDecision(deps, reply, {
    route: DECLINE_ROUTE,
    actorUserId,
    key,
    canonical: { nomineeRequestId, ...body },
    run: (tx) => declineNomineeRequest(tx, deps, { nomineeRequestId, actorUserId, requestId: request.requestId, ...body }),
  })
}

export const registerAdminNomineeRequestRoutes = (application: FastifyInstance, deps: AdminNomineeRequestDeps): void => {
  application.get(QUEUE_ROUTE, (request, reply) => listQueue(deps, request, reply))
  application.get(SUMMARY_ROUTE, (request, reply) => getSummary(deps, request, reply))
  application.get(USER_REQUESTS_ROUTE, (request, reply) => listForUser(deps, request, reply))
  application.post(ACCEPT_ROUTE, (request, reply) => accept(deps, request, reply))
  application.post(DECLINE_ROUTE, (request, reply) => decline(deps, request, reply))
}
