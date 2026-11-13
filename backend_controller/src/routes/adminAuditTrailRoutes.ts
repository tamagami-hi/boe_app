import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { createdAtKeyset, paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditLogFilter, AuditTrailRepository, AuditTrailRow, AuditTrailScope } from "../repositories/auditTrailRepository.js"
import { computeFilterHash, iso, limitSchema, uuidParam } from "./adminRouteKit.js"
import { calendarDateSchema, indiaDayStart, indiaNextDayStart } from "./reportParams.js"

const AUDIT_TRAIL_ROUTE = "/v1/admin/audit-events"
const USER_AUDIT_TRAIL_ROUTE = "/v1/admin/users/:userId/audit-events"

const AUDIT_PERMISSIONS = ["audit.read"] as const

const AUDIT_PRESETS = ["recordings", "reversals", "growth", "maturity", "refunds"] as const

type AuditPreset = (typeof AUDIT_PRESETS)[number]

const PRESET_COMMANDS: Readonly<Record<AuditPreset, readonly string[]>> = {
  recordings: ["client_position.contribution_recorded"],
  reversals: ["client_position.entry_reversed"],
  growth: ["client_growth.individual", "client_growth.collective"],
  maturity: [
    "client_position.matured",
    "client_position.withdrawal",
    "client_position.reinvestment",
    "withdrawal_payout.paid",
    "withdrawal_payout.failed",
  ],
  refunds: ["refund.retry", "refund.reconcile"],
}

export interface AdminAuditTrailDeps {
  readonly webAuth: WebAuthDeps
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: { readonly cursorKey: Buffer }
  readonly auditTrailRepository: AuditTrailRepository
}

const pageQuery = { after: z.string().min(1).optional(), limit: limitSchema }

const auditTrailQuerySchema = z
  .object({
    preset: z.enum(AUDIT_PRESETS).optional(),
    entityType: z.string().trim().max(80).optional(),
    command: z.string().trim().max(120).optional(),
    fromDate: calendarDateSchema.optional(),
    toDate: calendarDateSchema.optional(),
    ...pageQuery,
  })
  .strict()

const userAuditTrailQuerySchema = z.object(pageQuery).strict()

const auditTrailBody = (row: AuditTrailRow) => ({
  id: row.id,
  occurredAt: iso(row.occurredAt),
  actorType: row.actorType,
  actorUserId: row.actorUserId,
  actorEmail: row.actorEmail,
  command: row.command,
  entityType: row.entityType,
  entityId: row.entityId,
  fromState: row.fromState,
  toState: row.toState,
  requestId: row.requestId,
  client:
    row.clientUserId === null || row.clientName === null
      ? null
      : { userId: row.clientUserId, fullName: row.clientName },
  amountPaise: row.amountPaise,
  fundId: row.fundId,
  orderId: row.orderId,
  ledgerEntryId: row.ledgerEntryId,
})

const emptyToNull = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value

const logFilterOf = (query: z.infer<typeof auditTrailQuerySchema>): AuditLogFilter => {
  if (query.fromDate !== undefined && query.toDate !== undefined && query.fromDate > query.toDate) {
    throw new AppError("VALIDATION_FAILED", { fields: { toDate: ["must not be before fromDate"] } })
  }
  return {
    commands: query.preset === undefined ? null : PRESET_COMMANDS[query.preset],
    entityType: emptyToNull(query.entityType),
    command: emptyToNull(query.command),
    occurredFrom: query.fromDate === undefined ? null : indiaDayStart(query.fromDate),
    occurredBefore: query.toDate === undefined ? null : indiaNextDayStart(query.toDate),
  }
}

const sendTrailPage = async (
  deps: AdminAuditTrailDeps,
  reply: FastifyReply,
  input: Readonly<{ route: string; scope: AuditTrailScope; filters: Readonly<Record<string, unknown>>; after?: string; limit: number }>,
) => {
  const now = deps.clock()
  const filterHash = computeFilterHash(input.filters)
  const boundary = readKeyset(deps.config.cursorKey, input.after, input.route, filterHash, now)
  const rows = await deps.auditTrailRepository.listAuditTrail(deps.database, {
    ...boundary,
    scope: input.scope,
    limit: input.limit + 1,
  })
  const { items, page } = paginate(deps.config.cursorKey, rows, input.limit, input.route, filterHash, now, createdAtKeyset)
  return reply.sendData({ items: items.map(auditTrailBody) }, { status: 200, page })
}

const authorize = async (deps: AdminAuditTrailDeps, request: FastifyRequest): Promise<void> => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, AUDIT_PERMISSIONS)
}

const listAuditTrail = async (deps: AdminAuditTrailDeps, request: FastifyRequest, reply: FastifyReply) => {
  await authorize(deps, request)
  const query = parseOrThrow(auditTrailQuerySchema, request.query)
  const filter = logFilterOf(query)
  return sendTrailPage(deps, reply, {
    route: AUDIT_TRAIL_ROUTE,
    scope: { kind: "log", filter },
    filters: {
      preset: query.preset ?? null,
      entityType: filter.entityType,
      command: filter.command,
      fromDate: query.fromDate ?? null,
      toDate: query.toDate ?? null,
    },
    ...(query.after === undefined ? {} : { after: query.after }),
    limit: query.limit,
  })
}

const listUserAuditTrail = async (deps: AdminAuditTrailDeps, request: FastifyRequest, reply: FastifyReply) => {
  await authorize(deps, request)
  const userId = parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId).toLowerCase()
  const query = parseOrThrow(userAuditTrailQuerySchema, request.query)
  if (!(await deps.auditTrailRepository.userExists(deps.database, userId))) throw new AppError("RESOURCE_NOT_FOUND")
  return sendTrailPage(deps, reply, {
    route: USER_AUDIT_TRAIL_ROUTE,
    scope: { kind: "user", userId },
    filters: { userId },
    ...(query.after === undefined ? {} : { after: query.after }),
    limit: query.limit,
  })
}

export const registerAdminAuditTrailRoutes = (application: FastifyInstance, deps: AdminAuditTrailDeps): void => {
  application.get(AUDIT_TRAIL_ROUTE, (request, reply) => listAuditTrail(deps, request, reply))
  application.get(USER_AUDIT_TRAIL_ROUTE, (request, reply) => listUserAuditTrail(deps, request, reply))
}
