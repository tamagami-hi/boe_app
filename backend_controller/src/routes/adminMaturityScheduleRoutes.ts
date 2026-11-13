import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, Transaction } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { maturityDueWindow } from "../domain/admin/maturityDueWindow.js"
import {
  resolveMaturity,
  type FollowUpSchedule,
  type MaturityResolutionDeps,
  type ResolveMaturityCommand,
} from "../domain/admin/maturityResolutions.js"
import {
  cancelMaturitySchedule,
  editMaturityDate,
  setMaturityDate,
  type OwnScheduleCommand,
} from "../domain/admin/maturitySchedules.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import type { IdempotencyRetention } from "../http/idempotencyProtocol.js"
import { createdAtKeyset, paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import { POSITION_READ_PERMISSIONS, POSITION_WRITE_PERMISSIONS } from "./adminClientPositionRoutes.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"
import {
  cancelMaturityBodySchema,
  dashboardQuerySchema,
  dueQuerySchema,
  editMaturityBodySchema,
  mapDueWindow,
  mapMaturitySchedule,
  resolveMaturityBodySchema,
  setMaturityBodySchema,
  type ResolveMaturityBody,
} from "./maturityScheduleProjection.js"

const DASHBOARD_ROUTE = "/v1/admin/maturities"
const DUE_ROUTE = "/v1/admin/maturities/due"
const CLIENT_ROUTE = "/v1/admin/clients/:userId/maturity-schedules"
const SCHEDULE_ROUTE = `${CLIENT_ROUTE}/:scheduleId`
const CANCEL_ROUTE = `${SCHEDULE_ROUTE}/cancel`
const RESOLVE_ROUTE = `${SCHEDULE_ROUTE}/resolve`

export interface AdminMaturityScheduleDeps extends MaturityResolutionDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: Readonly<{ idempotencyTtlMs: number; cursorKey: Buffer }>
}

type MutationResult = Readonly<{ status: number; body: Readonly<Record<string, unknown>> }>

interface MutationPlan {
  readonly route: string
  readonly method?: "POST" | "PATCH"
  readonly retention?: IdempotencyRetention
  readonly hash: Readonly<Record<string, unknown>>
  readonly execute: (tx: Transaction, actor: Readonly<{ actorUserId: string; requestId: string }>) => Promise<MutationResult>
}

const paramOf = (request: FastifyRequest, name: "userId" | "scheduleId"): string =>
  parseOrThrow(uuidParam, (request.params as Record<string, unknown>)[name])

const mutate = async (
  deps: AdminMaturityScheduleDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  plan: (request: FastifyRequest) => MutationPlan,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [...POSITION_WRITE_PERMISSIONS])
  const command = plan(request)
  const key = requireIdempotencyKey(request)
  const now = deps.clock()
  const actor = { actorUserId: principal.userId, requestId: request.requestId }
  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now,
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    ...(command.retention === undefined ? {} : { retention: command.retention }),
    scope: adminIdempotencyScope(principal.userId, command.route, key, command.method ?? "POST"),
    requestHash: hashRequest(command.hash),
    execute: (tx) => command.execute(tx, actor),
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const scheduleBody = (deps: AdminMaturityScheduleDeps, row: Parameters<typeof mapMaturitySchedule>[0]) => ({
  schedule: mapMaturitySchedule(row, maturityDueWindow(deps.clock())),
})

const setPlan = (deps: AdminMaturityScheduleDeps) => (request: FastifyRequest): MutationPlan => {
  const userId = paramOf(request, "userId")
  const body = parseOrThrow(setMaturityBodySchema, request.body)
  return {
    route: CLIENT_ROUTE,
    hash: { userId, ...body },
    execute: async (tx, actor) => ({
      status: 201,
      body: scheduleBody(deps, await setMaturityDate(tx, deps, { ...actor, userId, ...body })),
    }),
  }
}

const editPlan = (deps: AdminMaturityScheduleDeps) => (request: FastifyRequest): MutationPlan => {
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const body = parseOrThrow(editMaturityBodySchema, request.body)
  return {
    route: SCHEDULE_ROUTE,
    method: "PATCH",
    hash: { userId, scheduleId, ...body },
    execute: async (tx, actor) => ({
      status: 200,
      body: scheduleBody(deps, await editMaturityDate(tx, deps, { ...actor, userId, scheduleId, ...body })),
    }),
  }
}

const cancelPlan = (deps: AdminMaturityScheduleDeps) => (request: FastifyRequest): MutationPlan => {
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const body = parseOrThrow(cancelMaturityBodySchema, request.body)
  return {
    route: CANCEL_ROUTE,
    hash: { userId, scheduleId, ...body },
    execute: async (tx, actor) => ({
      status: 200,
      body: scheduleBody(deps, await cancelMaturitySchedule(tx, deps, { ...actor, userId, scheduleId, ...body })),
    }),
  }
}

const followUpOf = (sip: Extract<ResolveMaturityBody, { sip: unknown }>["sip"]): FollowUpSchedule => ({
  ...sip,
  monthlyAmountPaise: BigInt(sip.monthlyAmountPaise),
})

const toResolveCommand = (body: ResolveMaturityBody, own: OwnScheduleCommand): ResolveMaturityCommand => {
  switch (body.resolution) {
    case "return_all":
      return { ...own, resolution: body.resolution, effectiveDate: body.effectiveDate, amountPaise: BigInt(body.amountPaise) }
    case "one_time_and_sip":
      return { ...own, resolution: body.resolution, effectiveDate: body.effectiveDate, sip: followUpOf(body.sip) }
    case "sip_reinvestment":
      return { ...own, resolution: body.resolution, sip: followUpOf(body.sip) }
  }
}

const resolvePlan = (deps: AdminMaturityScheduleDeps) => (request: FastifyRequest): MutationPlan => {
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const body = parseOrThrow(resolveMaturityBodySchema, request.body)
  return {
    route: RESOLVE_ROUTE,
    retention: "durable",
    hash: { userId, scheduleId, ...body },
    execute: async (tx, actor) => {
      const outcome = await resolveMaturity(
        tx,
        deps,
        toResolveCommand(body, { ...actor, userId, scheduleId, expectedVersion: body.expectedVersion }),
      )
      return {
        status: 200,
        body: {
          ...scheduleBody(deps, outcome.schedule),
          settlementEntryId: outcome.settlementEntryId,
          payoutId: outcome.payoutId,
          closedSipScheduleId: outcome.closedSipScheduleId,
        },
      }
    },
  }
}

const listForClient = async (deps: AdminMaturityScheduleDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const rows = await deps.maturityScheduleRepository.listByUser(deps.database, userId)
  const window = maturityDueWindow(deps.clock())
  return reply.sendData({ items: rows.map((row) => mapMaturitySchedule(row, window)) }, { status: 200 })
}

const listDashboard = async (deps: AdminMaturityScheduleDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const query = parseOrThrow(dashboardQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ state: query.state })
  const boundary = readKeyset(deps.config.cursorKey, query.after, DASHBOARD_ROUTE, filterHash, now)
  const rows = await deps.maturityScheduleRepository.listDashboard(deps.database, {
    ...boundary,
    state: query.state,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(deps.config.cursorKey, rows, query.limit, DASHBOARD_ROUTE, filterHash, now, createdAtKeyset)
  const window = maturityDueWindow(now)
  return reply.sendData({ items: items.map((row) => mapMaturitySchedule(row, window)) }, { status: 200, page })
}

const listDue = async (deps: AdminMaturityScheduleDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const query = parseOrThrow(dueQuerySchema, request.query)
  const window = maturityDueWindow(deps.clock())
  const [rows, total] = await Promise.all([
    deps.maturityScheduleRepository.listDue(deps.database, { dueThrough: window.dueThrough, limit: query.limit }),
    deps.maturityScheduleRepository.countDue(deps.database, window.dueThrough),
  ])
  return reply.sendData(
    { ...mapDueWindow(window), total, items: rows.map((row) => mapMaturitySchedule(row, window)) },
    { status: 200 },
  )
}

export const registerAdminMaturityScheduleRoutes = (
  application: FastifyInstance,
  deps: AdminMaturityScheduleDeps,
): void => {
  application.get(DASHBOARD_ROUTE, (request, reply) => listDashboard(deps, request, reply))
  application.get(DUE_ROUTE, (request, reply) => listDue(deps, request, reply))
  application.get(CLIENT_ROUTE, (request, reply) => listForClient(deps, request, reply))
  application.post(CLIENT_ROUTE, (request, reply) => mutate(deps, request, reply, setPlan(deps)))
  application.patch(SCHEDULE_ROUTE, (request, reply) => mutate(deps, request, reply, editPlan(deps)))
  application.post(CANCEL_ROUTE, (request, reply) => mutate(deps, request, reply, cancelPlan(deps)))
  application.post(RESOLVE_ROUTE, (request, reply) => mutate(deps, request, reply, resolvePlan(deps)))
}
