import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { exitSipEarly, readSipEarlyExitHolding, type SipEarlyExitDeps } from "../domain/admin/earlyExit.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import { POSITION_READ_PERMISSIONS, POSITION_WRITE_PERMISSIONS } from "./adminClientPositionRoutes.js"
import {
  adminIdempotencyScope,
  hashRequest,
  positivePaiseSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"
import { mapAdminSipEarlyExit, mapSipEarlyExitPreview } from "./earlyExitProjection.js"

const EARLY_EXIT_ROUTE = "/v1/admin/clients/:userId/sip-schedules/:scheduleId/early-exit"
const CLIENT_EARLY_EXITS_ROUTE = "/v1/admin/clients/:userId/sip-early-exits"

export interface AdminSipEarlyExitDeps extends SipEarlyExitDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: Readonly<{ idempotencyTtlMs: number; sesConfigurationSet: string }>
}

const exitBodySchema = z
  .object({ expectedVersion: z.number().int().positive(), expectedValuePaise: positivePaiseSchema })
  .strict()

const paramOf = (request: FastifyRequest, name: "userId" | "scheduleId"): string =>
  parseOrThrow(uuidParam, (request.params as Record<string, unknown>)[name])

const preview = async (deps: AdminSipEarlyExitDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const body = await deps.unitOfWork.execute(async (tx) => {
    const schedule = await deps.sipScheduleRepository.findForUser(tx, { userId, scheduleId })
    if (schedule === null) throw new AppError("RESOURCE_NOT_FOUND")
    return mapSipEarlyExitPreview(schedule, await readSipEarlyExitHolding(tx, deps, schedule))
  })
  return reply.sendData(body, { status: 200 })
}

const exit = async (deps: AdminSipEarlyExitDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [...POSITION_WRITE_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const body = parseOrThrow(exitBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const now = deps.clock()

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now,
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    retention: "durable",
    scope: adminIdempotencyScope(principal.userId, EARLY_EXIT_ROUTE, key),
    requestHash: hashRequest({ userId, scheduleId, ...body }),
    execute: async (tx) => {
      const row = await exitSipEarly(tx, deps, {
        userId,
        scheduleId,
        expectedVersion: body.expectedVersion,
        expectedValuePaise: BigInt(body.expectedValuePaise),
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 201, body: { earlyExit: mapAdminSipEarlyExit(row) } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const listForClient = async (deps: AdminSipEarlyExitDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const rows = await deps.sipEarlyExitRepository.listByUser(deps.database, userId)
  return reply.sendData({ items: rows.map(mapAdminSipEarlyExit) }, { status: 200 })
}

export const registerAdminSipEarlyExitRoutes = (application: FastifyInstance, deps: AdminSipEarlyExitDeps): void => {
  application.get(EARLY_EXIT_ROUTE, (request, reply) => preview(deps, request, reply))
  application.post(EARLY_EXIT_ROUTE, (request, reply) => exit(deps, request, reply))
  application.get(CLIENT_EARLY_EXITS_ROUTE, (request, reply) => listForClient(deps, request, reply))
}
