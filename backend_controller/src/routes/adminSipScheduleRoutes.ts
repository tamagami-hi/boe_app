import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  closeAdminSipSchedule,
  createAdminSipSchedule,
  editAdminSipSchedule,
  type AdminSipScheduleDeps,
} from "../domain/admin/adminSipSchedules.js"
import { MAX_SCHEDULE_MONTHS } from "../domain/admin/sipScheduleMonths.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeysetValues } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import { POSITION_READ_PERMISSIONS, POSITION_WRITE_PERMISSIONS } from "./adminClientPositionRoutes.js"
import { mapAdminSipSchedule, sipMonthSchema } from "./sipScheduleProjection.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  limitSchema,
  positivePaiseSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const CLIENT_SCHEDULES_ROUTE = "/v1/admin/clients/:userId/sip-schedules"
const SCHEDULE_ROUTE = `${CLIENT_SCHEDULES_ROUTE}/:scheduleId`
const CLOSE_ROUTE = `${SCHEDULE_ROUTE}/close`
const FUND_SCHEDULES_ROUTE = "/v1/admin/sip-schedules"


export interface AdminSipScheduleRouteDeps extends AdminSipScheduleDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: Readonly<{ idempotencyTtlMs: number; cursorKey: Buffer }>
}

const monthCountSchema = z.number().int().min(1).max(MAX_SCHEDULE_MONTHS)
const versionSchema = z.number().int().positive()
const stateSchema = z.enum(["active", "closed"])

const createBodySchema = z
  .object({
    fundId: uuidParam,
    monthlyAmountPaise: positivePaiseSchema,
    startMonth: sipMonthSchema,
    monthCount: monthCountSchema,
  })
  .strict()

const editBodySchema = z
  .object({
    expectedVersion: versionSchema,
    monthlyAmountPaise: positivePaiseSchema.optional(),
    monthCount: monthCountSchema.optional(),
    state: stateSchema.optional(),
  })
  .strict()

const closeBodySchema = z.object({ expectedVersion: versionSchema }).strict()

const fundQuerySchema = z
  .object({ fundId: uuidParam, state: stateSchema.optional(), after: z.string().min(1).optional(), limit: limitSchema })
  .strict()

const paramOf = (request: FastifyRequest, name: "userId" | "scheduleId"): string =>
  parseOrThrow(uuidParam, (request.params as Record<string, unknown>)[name])

const listForClient = async (deps: AdminSipScheduleRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const rows = await deps.sipScheduleRepository.listByUser(deps.database, userId)
  const now = deps.clock()
  return reply.sendData({ items: rows.map((row) => mapAdminSipSchedule(row, now)) }, { status: 200 })
}

const afterScheduleIdOf = (values: readonly string[]): string | null => {
  if (values.length === 0) return null
  const parsed = uuidParam.safeParse(values[0])
  if (values.length !== 1 || !parsed.success) throw new AppError("CURSOR_INVALID")
  return parsed.data
}

const listForFund = async (deps: AdminSipScheduleRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const query = parseOrThrow(fundQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ fundId: query.fundId, state: query.state ?? null })
  const afterScheduleId = afterScheduleIdOf(
    readKeysetValues(deps.config.cursorKey, query.after, FUND_SCHEDULES_ROUTE, filterHash, now),
  )
  const rows = await deps.sipScheduleRepository.listByFund(deps.database, {
    fundId: query.fundId,
    state: query.state ?? null,
    afterScheduleId,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(deps.config.cursorKey, rows, query.limit, FUND_SCHEDULES_ROUTE, filterHash, now, (row) => [
    row.id,
  ])
  return reply.sendData({ items: items.map((row) => mapAdminSipSchedule(row, now)) }, { status: 200, page })
}

const create = async (deps: AdminSipScheduleRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [...POSITION_WRITE_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const body = parseOrThrow(createBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const now = deps.clock()

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now,
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, CLIENT_SCHEDULES_ROUTE, key),
    requestHash: hashRequest({ userId, ...body }),
    execute: async (tx) => {
      const row = await createAdminSipSchedule(tx, deps, {
        userId,
        fundId: body.fundId,
        monthlyAmountPaise: BigInt(body.monthlyAmountPaise),
        startMonth: body.startMonth,
        monthCount: body.monthCount,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 201, body: { schedule: mapAdminSipSchedule(row, now) } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const edit = async (deps: AdminSipScheduleRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [...POSITION_WRITE_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const body = parseOrThrow(editBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const now = deps.clock()

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now,
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, SCHEDULE_ROUTE, key, "PATCH"),
    requestHash: hashRequest({ userId, scheduleId, ...body }),
    execute: async (tx) => {
      const row = await editAdminSipSchedule(tx, deps, {
        userId,
        scheduleId,
        expectedVersion: body.expectedVersion,
        ...(body.monthlyAmountPaise === undefined ? {} : { monthlyAmountPaise: BigInt(body.monthlyAmountPaise) }),
        ...(body.monthCount === undefined ? {} : { monthCount: body.monthCount }),
        ...(body.state === undefined ? {} : { state: body.state }),
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 200, body: { schedule: mapAdminSipSchedule(row, now) } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const close = async (deps: AdminSipScheduleRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [...POSITION_WRITE_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const body = parseOrThrow(closeBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const now = deps.clock()

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now,
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, CLOSE_ROUTE, key),
    requestHash: hashRequest({ userId, scheduleId, ...body }),
    execute: async (tx) => {
      const row = await closeAdminSipSchedule(tx, deps, {
        userId,
        scheduleId,
        expectedVersion: body.expectedVersion,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 200, body: { schedule: mapAdminSipSchedule(row, now) } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

export const registerAdminSipScheduleRoutes = (application: FastifyInstance, deps: AdminSipScheduleRouteDeps): void => {
  application.get(CLIENT_SCHEDULES_ROUTE, (request, reply) => listForClient(deps, request, reply))
  application.get(FUND_SCHEDULES_ROUTE, (request, reply) => listForFund(deps, request, reply))
  application.post(CLIENT_SCHEDULES_ROUTE, (request, reply) => create(deps, request, reply))
  application.patch(SCHEDULE_ROUTE, (request, reply) => edit(deps, request, reply))
  application.post(CLOSE_ROUTE, (request, reply) => close(deps, request, reply))
}
