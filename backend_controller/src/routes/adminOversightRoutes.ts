/**
 * Admin oversight routes. Web-cookie transport, RBAC per group, CSRF on unsafe
 * methods, keyset cursors.
 *
 *   GET   /v1/admin/users                     directory (state/search filters)      users.read
 *   GET   /v1/admin/users/:id/detail          one user + roles/email verification/recent orders    users.read
 *   GET   /v1/admin/users/:id/login-events    per-user sign-in attempts            users.read
 *   POST  /v1/admin/users/:id/suspend         lifecycle: active -> suspended        users.suspend
 *   POST  /v1/admin/users/:id/reinstate       lifecycle: suspended -> active        users.suspend
 *   POST  /v1/admin/users/:id/close           lifecycle: -> closed (terminal)       users.close
 *   GET   /v1/admin/audit-logs                redacted audit log                    audit.read
 *
 * Deliberate omissions: there is no payment approve/reject (confirmation is
 * provider-callback driven) and no capital inflow/outflow or reconciliation
 * ledger. The payment/review/refund and growth admin surfaces are rebuilt on
 * top of the new schema by later waves; this module keeps only the user
 * directory, the user lifecycle, and the audit log.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, UserId } from "../db/repositories.js"
import type { Database, EmailVerificationState, UserAccountState } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { AdminOversightRepository } from "../repositories/adminOversightRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { AuthSessionWriteRepository } from "../repositories/authSessionRepository.js"
import type { LoginEventRepository, LoginEventRow } from "../repositories/loginEventRepository.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  iso,
  isoOrNull,
  limitSchema,
  optionalIdempotencyKey,
  reasonCodeSchema,
  reasonDetailSchema,
  runAdminMutation,
  searchSchema,
  uuidParam,
} from "./adminRouteKit.js"

export interface AdminOversightConfig {
  readonly cursorKey: Buffer
  readonly idempotencyTtlMs: number
}

export interface AdminOversightDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: AdminOversightConfig
  readonly oversightRepository: AdminOversightRepository
  readonly loginEventRepository: LoginEventRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly authSessionRepository: Pick<AuthSessionWriteRepository, "revokeAllForUser">
}

const USERS_ROUTE = "/v1/admin/users"
const AUDIT_ROUTE = "/v1/admin/audit-logs"
const LOGIN_EVENTS_ROUTE = "/v1/admin/users/:userId/login-events"

// --- schemas ---

const pageQuery = { after: z.string().min(1).optional(), limit: limitSchema }

const usersQuerySchema = z
  .object({
    ...pageQuery,
    status: z.enum(["invited", "active", "suspended", "closed"]).optional(),
    q: searchSchema.optional(),
  })
  .strict()

const auditQuerySchema = z
  .object({
    ...pageQuery,
    entityType: z.string().trim().max(80).optional(),
    command: z.string().trim().max(120).optional(),
    actorUserId: z.string().uuid().optional(),
    occurredFrom: z.string().datetime({ offset: true }).optional(),
    occurredTo: z.string().datetime({ offset: true }).optional(),
  })
  .strict()

const loginEventsQuerySchema = z.object({ ...pageQuery }).strict()

const lifecycleBodySchema = z
  .object({ reasonCode: reasonCodeSchema.optional(), reason: reasonDetailSchema.optional() })
  .strict()
  .optional()

export const shouldRevokeUserSessions = (nextState: UserAccountState): boolean =>
  nextState === "suspended" || nextState === "closed"

// --- generic list plumbing ---

interface Listed {
  readonly id: string
  readonly createdAt: Date | string
}

const listWith = async <Row extends Listed>(
  deps: AdminOversightDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  permissions: readonly string[],
  filters: Readonly<Record<string, unknown>>,
  load: (limit: number, keyset: ReturnType<typeof readKeyset>) => Promise<readonly Row[]>,
  map: (row: Row) => Record<string, unknown>,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, permissions)
  const now = deps.clock()
  const filterHash = computeFilterHash(filters)
  const after = (request.query as { after?: string } | undefined)?.after
  const keyset = readKeyset(deps.config.cursorKey, after, route, filterHash, now)
  const limit = Number((request.query as { limit?: unknown } | undefined)?.limit ?? 25)
  const rows = await load(limit + 1, keyset)
  const { items, page } = paginate(deps.config.cursorKey, rows, limit, route, filterHash, now, (row) => [
    iso(row.createdAt),
    row.id,
  ])
  return reply.sendData({ items: items.map(map) }, { status: 200, page })
}

/** Shared mutation wrapper: optional idempotency key, single transaction. */
const mutate = async <TBody extends Record<string, unknown>>(
  deps: AdminOversightDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  routeTemplate: string,
  method: "POST" | "PATCH" | "DELETE",
  canonical: Readonly<Record<string, unknown>>,
  principalUserId: string,
  execute: (tx: Parameters<Parameters<UnitOfWork["execute"]>[0]>[0]) => Promise<{ status: number; body: TBody }>,
) => {
  const key = optionalIdempotencyKey(request)
  if (key === null) {
    const outcome = await deps.unitOfWork.execute((tx) => execute(tx))
    return reply.sendData(outcome.body, { status: outcome.status })
  }
  const result = await runAdminMutation<TBody>({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principalUserId, routeTemplate, key, method),
    requestHash: hashRequest(canonical),
    execute,
  })
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

// --- mappers ---

const mapUser = (row: {
  readonly id: string
  readonly fullName: string
  readonly email: string
  readonly phone: string
  readonly accountState: UserAccountState
  readonly isPiiTombstoned: boolean
  readonly activatedAt: Date | null
  readonly suspendedAt: Date | null
  readonly closedAt: Date | null
  readonly emailVerificationState: string | null
  readonly ordersCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}): Record<string, unknown> => ({
  id: row.id,
  name: row.fullName,
  fullName: row.fullName,
  email: row.email,
  phone: row.phone,
  status: row.accountState,
  accountState: row.accountState,
  isPiiTombstoned: row.isPiiTombstoned,
  emailVerificationStatus: row.emailVerificationState,
  ordersCount: row.ordersCount,
  activatedAt: isoOrNull(row.activatedAt),
  suspendedAt: isoOrNull(row.suspendedAt),
  closedAt: isoOrNull(row.closedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

const mapOrder = (row: {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly fundId: string
  readonly fundSlug: string
  readonly fundName: string | null
  readonly sipPlanId: string | null
  readonly type: string
  readonly state: string
  readonly amountPaise: string
  readonly currency: string
  readonly requestedAt: Date
  readonly acceptedAt: Date | null
  readonly failureCode: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}): Record<string, unknown> => ({
  id: row.id,
  userId: row.userId,
  userEmail: row.userEmail,
  fundId: row.fundId,
  fundSlug: row.fundSlug,
  fundName: row.fundName,
  sipPlanId: row.sipPlanId,
  type: row.type,
  status: row.state,
  amountPaise: row.amountPaise,
  currency: row.currency,
  requestedAt: iso(row.requestedAt),
  acceptedAt: isoOrNull(row.acceptedAt),
  failureCode: row.failureCode,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

const mapEmailVerification = (row: {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly userFullName: string
  readonly state: EmailVerificationState
  readonly provider: string | null
  readonly submittedAt: Date | null
  readonly decidedAt: Date | null
  readonly reviewCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}): Record<string, unknown> => ({
  id: row.id,
  userId: row.userId,
  userEmail: row.userEmail,
  name: row.userFullName,
  emailVerificationStatus: row.state,
  status: row.state,
  provider: row.provider,
  submittedAt: isoOrNull(row.submittedAt),
  emailVerifiedAt: isoOrNull(row.decidedAt),
  decidedAt: isoOrNull(row.decidedAt),
  reviewCount: row.reviewCount,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

const mapAuditEvent = (row: {
  readonly id: string
  readonly occurredAt: Date
  readonly actorType: string
  readonly actorUserId: string | null
  readonly actorEmail: string | null
  readonly command: string
  readonly entityType: string
  readonly entityId: string
  readonly fromState: string | null
  readonly toState: string | null
  readonly reasonCode: string | null
  readonly requestId: string
  readonly entityVersion: string
  readonly metadata: unknown
  readonly createdAt: Date
}): Record<string, unknown> => ({
  id: row.id,
  occurredAt: iso(row.occurredAt),
  createdAt: iso(row.occurredAt),
  actorType: row.actorType,
  actorUserId: row.actorUserId,
  actorEmail: row.actorEmail,
  action: row.command,
  command: row.command,
  entityType: row.entityType,
  entityId: row.entityId,
  fromState: row.fromState,
  toState: row.toState,
  reasonCode: row.reasonCode,
  requestId: row.requestId,
  entityVersion: Number(row.entityVersion),
  metadata: row.metadata,
})

// --- users ---

const listUsers = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const query = parseOrThrow(usersQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    USERS_ROUTE,
    ["users.read", "users.read_limited"],
    { status: query.status ?? null, q: query.q ?? null },
    async (limit, keyset) =>
      deps.oversightRepository.listUsers(deps.database, {
        ...keyset,
        limit,
        ...(query.status === undefined ? {} : { state: query.status }),
        ...(query.q === undefined ? {} : { search: query.q }),
      }),
    mapUser,
  )
}

const getUserDetail = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["users.read"])
  const userId = parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)
  const detail = await deps.oversightRepository.userDetail(deps.database, userId)
  if (detail === null) throw new AppError("RESOURCE_NOT_FOUND")

  return reply.sendData(
    {
      user: mapUser(detail.user),
      roles: detail.roles,
      emailVerification: detail.emailVerification === null ? null : mapEmailVerification(detail.emailVerification),
      orders: detail.orders.map(mapOrder),
    },
    { status: 200 },
  )
}

const changeUserState = async (
  deps: AdminOversightDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  nextState: UserAccountState,
  permissions: readonly string[],
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, permissions)
  const userId = parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)
  const body = parseOrThrow(lifecycleBodySchema, request.body ?? undefined)
  const now = deps.clock()

  return mutate(
    deps,
    request,
    reply,
    `${USERS_ROUTE}/:userId/${nextState}`,
    "POST",
    { userId, nextState },
    principal.userId,
    async (tx) => {
      const user = await deps.oversightRepository.lockUser(tx, userId)
      if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
      // Closed is terminal; suspending an invited account or reinstating an
      // active one are both no-op transitions the console should not request.
      const allowed =
        (nextState === "suspended" && user.account_state === "active") ||
        (nextState === "active" && user.account_state === "suspended") ||
        (nextState === "closed" && user.account_state !== "closed")
      if (!allowed) throw new AppError("STATE_CONFLICT")

      const updated = await deps.oversightRepository.setUserAccountState(tx, {
        userId,
        state: nextState,
        now,
        expectedVersion: Number(user.version),
      })
      if (updated === null) throw new AppError("STATE_CONFLICT")

      if (shouldRevokeUserSessions(nextState)) {
        await deps.authSessionRepository.revokeAllForUser(tx, {
          userId: userId as UserId,
          reason: `account_${nextState}`,
          now,
        })
      }

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: `user.${nextState}`,
        entityType: "user",
        entityId: userId,
        fromState: user.account_state,
        toState: updated.account_state,
        requestId: request.requestId,
        entityVersion: Number(updated.version),
        metadata: {
          ...(body?.reasonCode === undefined ? {} : { reasonCode: body.reasonCode }),
          ...(body?.reason === undefined ? {} : { reason: body.reason }),
        },
      })
      return {
        status: 200,
        body: { userId, status: updated.account_state, version: Number(updated.version) },
      }
    },
  )
}

// --- audit ---

const listAuditEvents = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const query = parseOrThrow(auditQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    AUDIT_ROUTE,
    ["audit.read"],
    {
      entityType: query.entityType ?? null,
      command: query.command ?? null,
      actorUserId: query.actorUserId ?? null,
      occurredFrom: query.occurredFrom ?? null,
      occurredTo: query.occurredTo ?? null,
    },
    async (limit, keyset) =>
      deps.oversightRepository.listAuditEvents(deps.database, {
        ...keyset,
        limit,
        ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
        ...(query.command === undefined ? {} : { command: query.command }),
        ...(query.actorUserId === undefined ? {} : { actorUserId: query.actorUserId }),
        ...(query.occurredFrom === undefined ? {} : { occurredFrom: new Date(query.occurredFrom) }),
        ...(query.occurredTo === undefined ? {} : { occurredTo: new Date(query.occurredTo) }),
      }),
    (row) => mapAuditEvent(row),
  )
}

// --- login history ---

/**
 * Per-user sign-in attempts, newest first.
 *
 * Distinct from `/v1/admin/audit-logs`: the audit log records successful logins
 * only (they are state transitions with a session to point at), whereas this
 * shows failures too, with the address and User-Agent the attempt came from.
 * `users.read` rather than `audit.read` — it is part of looking at one user.
 */
const mapLoginEvent = (row: LoginEventRow): Record<string, unknown> => ({
  id: row.id,
  occurredAt: iso(row.occurredAt),
  createdAt: iso(row.createdAt),
  userId: row.userId,
  email: row.email,
  channel: row.channel,
  outcome: row.outcome,
  succeeded: row.outcome === "success",
  sessionId: row.sessionId,
  ipAddress: row.ipAddress,
  userAgent: row.userAgent,
  requestId: row.requestId,
})

const listUserLoginEvents = async (
  deps: AdminOversightDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const userId = parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)
  parseOrThrow(loginEventsQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    LOGIN_EVENTS_ROUTE,
    ["users.read"],
    // The user is part of the filter identity, so a cursor issued for one user is
    // not accepted for another.
    { userId },
    async (limit, keyset) =>
      deps.loginEventRepository.listForUser(deps.database, { ...keyset, limit, userId }),
    mapLoginEvent,
  )
}

export const registerAdminOversightRoutes = (
  application: FastifyInstance,
  deps: AdminOversightDeps,
): void => {
  application.get(USERS_ROUTE, async (request, reply) => listUsers(deps, request, reply))
  application.get(`${USERS_ROUTE}/:userId/detail`, async (request, reply) =>
    getUserDetail(deps, request, reply),
  )
  application.get(`${USERS_ROUTE}/:userId/login-events`, async (request, reply) =>
    listUserLoginEvents(deps, request, reply),
  )
  application.post(`${USERS_ROUTE}/:userId/suspend`, async (request, reply) =>
    changeUserState(deps, request, reply, "suspended", ["users.suspend"]),
  )
  application.post(`${USERS_ROUTE}/:userId/reinstate`, async (request, reply) =>
    changeUserState(deps, request, reply, "active", ["users.suspend"]),
  )
  application.post(`${USERS_ROUTE}/:userId/close`, async (request, reply) =>
    changeUserState(deps, request, reply, "closed", ["users.close"]),
  )

  application.get(AUDIT_ROUTE, async (request, reply) => listAuditEvents(deps, request, reply))
}
