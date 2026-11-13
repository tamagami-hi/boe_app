import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { eraseClient, type ClientErasureDeps, type ErasureOutcome } from "../domain/admin/clientErasure.js"
import { checkClientErasure, type ErasureCheck } from "../domain/admin/clientErasureCheck.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { parseOrThrow } from "../http/validation.js"
import {
  adminIdempotencyScope,
  hashRequest,
  iso,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const ERASE_ROUTE = "/v1/admin/clients/:userId/erase"
const CHECK_ROUTE = "/v1/admin/clients/:userId/erase-check"
const ERASE_PERMISSIONS = ["users.close"] as const

export const ERASE_CONFIRMATION = "ERASE"

export interface AdminClientErasureDeps extends ClientErasureDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: { readonly idempotencyTtlMs: number }
}

const eraseBodySchema = z
  .object({
    confirm: z.literal(ERASE_CONFIRMATION),
    expectedPath: z.enum(["deleted", "kept_as_record"]),
  })
  .strict()

const userIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)

const checkBody = (check: ErasureCheck) =>
  check.state === "already_erased"
    ? {
        userId: check.userId,
        state: check.state,
        fullName: check.fullName,
        emailVerified: null,
        path: check.plan.path,
        keptBecause: check.plan.keptBecause,
        blockers: [],
        erasedAt: iso(check.erasedAt),
      }
    : {
        userId: check.userId,
        state: check.state,
        fullName: check.fullName,
        emailVerified: check.emailVerified,
        path: check.plan.path,
        keptBecause: check.plan.keptBecause,
        blockers: check.blockers.map((blocker) => ({ code: blocker.code, count: blocker.count, message: blocker.message })),
        erasedAt: null,
      }

const outcomeBody = (outcome: ErasureOutcome) => ({
  userId: outcome.userId,
  outcome: outcome.outcome,
  path: outcome.path,
  keptBecause: outcome.keptBecause,
  erasedAt: iso(outcome.erasedAt),
})

const getErasureCheck = async (deps: AdminClientErasureDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ERASE_PERMISSIONS)
  const userId = userIdOf(request)
  const check = await deps.unitOfWork.execute((tx) => checkClientErasure(tx, deps, userId))
  return reply.sendData(checkBody(check), { status: 200 })
}

const postErasure = async (deps: AdminClientErasureDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ERASE_PERMISSIONS)
  const userId = userIdOf(request)
  const body = parseOrThrow(eraseBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    retention: "durable",
    scope: adminIdempotencyScope(principal.userId, ERASE_ROUTE, key),
    requestHash: hashRequest({ userId, confirm: body.confirm, expectedPath: body.expectedPath }),
    execute: async (tx) => {
      const outcome = await eraseClient(tx, deps, {
        userId,
        expectedPath: body.expectedPath,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 200, body: outcomeBody(outcome) }
    },
  })

  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerAdminClientErasureRoutes = (application: FastifyInstance, deps: AdminClientErasureDeps): void => {
  application.get(CHECK_ROUTE, (request, reply) => getErasureCheck(deps, request, reply))
  application.post(ERASE_ROUTE, (request, reply) => postErasure(deps, request, reply))
}
