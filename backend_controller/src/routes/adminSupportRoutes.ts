import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { SupportRequestState } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { respondToSupportTicket } from "../domain/admin/supportResponse.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import {
  createAdminSupportRepository,
  type AdminSupportRepository,
  type SupportTicketDetailRow,
  type SupportTicketEventRow,
  type SupportTicketRow,
} from "../repositories/adminSupportRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { NotificationWriteRepository } from "../repositories/notificationRepository.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  iso,
  isoOrNull,
  limitSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const TICKETS_ROUTE = "/v1/admin/support/tickets"
const TICKET_ROUTE = `${TICKETS_ROUTE}/:ticketId`
const RESPONSES_ROUTE = `${TICKET_ROUTE}/responses`
const USER_TICKETS_ROUTE = "/v1/admin/users/:userId/support-tickets"
const READ_PERMISSIONS = ["support.read"] as const
const WRITE_PERMISSIONS = ["support.write"] as const
const MAX_RESOLUTION_NOTE_LENGTH = 2_000

const SUPPORT_STATES = ["open", "in_progress", "resolved", "closed"] as const satisfies readonly SupportRequestState[]

export interface AdminSupportDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly config: { readonly cursorKey: Buffer; readonly idempotencyTtlMs: number }
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly notificationRepository: NotificationWriteRepository
}

interface SupportRouteDeps extends AdminSupportDeps {
  readonly adminSupportRepository: AdminSupportRepository
}

const pageQuery = { after: z.string().min(1).optional(), limit: limitSchema }

const inboxQuerySchema = z.object({ ...pageQuery, status: z.enum(SUPPORT_STATES).optional() }).strict()
const userTicketsQuerySchema = z.object(pageQuery).strict()

const respondBodySchema = z
  .object({
    status: z.enum(SUPPORT_STATES),
    resolutionNote: z.string().trim().min(1).max(MAX_RESOLUTION_NOTE_LENGTH),
    expectedVersion: z.number().int().positive(),
  })
  .strict()

const ticketBody = (row: SupportTicketRow) => ({
  id: row.id,
  userId: row.userId,
  clientName: row.clientName,
  reference: row.reference,
  category: row.category,
  subject: row.subject,
  status: row.state,
  resolvedAt: isoOrNull(row.resolvedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

const noteChangedOf = (metadata: unknown): boolean =>
  typeof metadata === "object" && metadata !== null && (metadata as { noteChanged?: unknown }).noteChanged === true

const eventBody = (row: SupportTicketEventRow) => ({
  id: row.id,
  command: row.command,
  actorType: row.actorType,
  actorName: row.actorName,
  fromState: row.fromState,
  toState: row.toState,
  noteChanged: noteChangedOf(row.metadata),
  occurredAt: iso(row.occurredAt),
})

const detailBody = (row: SupportTicketDetailRow, events: readonly SupportTicketEventRow[]) => ({
  ...ticketBody(row),
  body: row.body,
  resolutionNote: row.resolutionNote,
  closedAt: isoOrNull(row.closedAt),
  history: events.map(eventBody),
})

const paramOf = (request: FastifyRequest, name: "ticketId" | "userId"): string =>
  parseOrThrow(uuidParam, (request.params as Record<string, unknown> | undefined)?.[name])

const sendPage = (
  deps: SupportRouteDeps,
  reply: FastifyReply,
  route: string,
  filterHash: string,
  now: Date,
  limit: number,
  rows: readonly SupportTicketRow[],
) => {
  const { items, page } = paginate(deps.config.cursorKey, rows, limit, route, filterHash, now, (row) => [
    iso(row.createdAt),
    row.id,
  ])
  return reply.sendData({ items: items.map(ticketBody) }, { status: 200, page })
}

const listInbox = async (deps: SupportRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...READ_PERMISSIONS])
  const query = parseOrThrow(inboxQuerySchema, request.query ?? {})
  const now = deps.clock()
  const filterHash = computeFilterHash({ status: query.status })
  const keyset = readKeyset(deps.config.cursorKey, query.after, TICKETS_ROUTE, filterHash, now)
  const rows = await deps.unitOfWork.execute((tx) =>
    deps.adminSupportRepository.listQueue(tx, {
      ...keyset,
      ...(query.status === undefined ? {} : { state: query.status }),
      limit: query.limit + 1,
    }),
  )
  return sendPage(deps, reply, TICKETS_ROUTE, filterHash, now, query.limit, rows)
}

const listUserTickets = async (deps: SupportRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...READ_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const query = parseOrThrow(userTicketsQuerySchema, request.query ?? {})
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId })
  const keyset = readKeyset(deps.config.cursorKey, query.after, USER_TICKETS_ROUTE, filterHash, now)
  const rows = await deps.unitOfWork.execute(async (tx) => {
    if (!(await deps.adminSupportRepository.userExists(tx, userId))) return null
    return deps.adminSupportRepository.listForUser(tx, { userId, ...keyset, limit: query.limit + 1 })
  })
  if (rows === null) throw new AppError("RESOURCE_NOT_FOUND")
  return sendPage(deps, reply, USER_TICKETS_ROUTE, filterHash, now, query.limit, rows)
}

const getTicket = async (deps: SupportRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...READ_PERMISSIONS])
  const ticketId = paramOf(request, "ticketId")
  const found = await deps.unitOfWork.execute(async (tx) => {
    const ticket = await deps.adminSupportRepository.findTicket(tx, ticketId)
    if (ticket === null) return null
    return detailBody(ticket, await deps.adminSupportRepository.listEvents(tx, ticketId))
  })
  if (found === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData(found, { status: 200 })
}

const respond = async (deps: SupportRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [...WRITE_PERMISSIONS])
  const ticketId = paramOf(request, "ticketId")
  const body = parseOrThrow(respondBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, RESPONSES_ROUTE, key),
    requestHash: hashRequest({ ticketId, ...body }),
    execute: async (tx) => {
      const ticket = await respondToSupportTicket(tx, deps, {
        ticketId,
        expectedVersion: body.expectedVersion,
        state: body.status,
        resolutionNote: body.resolutionNote,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 200, body: detailBody(ticket, await deps.adminSupportRepository.listEvents(tx, ticketId)) }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

export const registerAdminSupportRoutes = (application: FastifyInstance, base: AdminSupportDeps): void => {
  const deps: SupportRouteDeps = { ...base, adminSupportRepository: createAdminSupportRepository() }
  application.get(TICKETS_ROUTE, (request, reply) => listInbox(deps, request, reply))
  application.get(TICKET_ROUTE, (request, reply) => getTicket(deps, request, reply))
  application.post(RESPONSES_ROUTE, (request, reply) => respond(deps, request, reply))
  application.get(USER_TICKETS_ROUTE, (request, reply) => listUserTickets(deps, request, reply))
}
