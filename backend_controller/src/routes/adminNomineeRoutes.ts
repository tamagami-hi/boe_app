import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { changeClientNominee, readNominee, type AdminNomineeDeps } from "../domain/client/nominee.js"
import { parseOrThrow } from "../http/validation.js"
import { adminIdempotencyScope, hashRequest, requireIdempotencyKey, runAdminMutation, uuidParam } from "./adminRouteKit.js"
import { nomineeBody, nomineeFields, nomineeOf, requireBothOrNeither } from "./nomineeSchemas.js"

const NOMINEE_ROUTE = "/v1/admin/users/:userId/nominee"
const READ_PERMISSIONS = ["users.read"] as const
const WRITE_PERMISSIONS = ["clients.create"] as const

export interface AdminNomineeRouteDeps extends AdminNomineeDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: { readonly idempotencyTtlMs: number }
}

const changeBodySchema = z
  .object({ ...nomineeFields, expectedVersion: z.number().int().positive() })
  .strict()
  .superRefine(requireBothOrNeither)

const userIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)

const getNominee = async (deps: AdminNomineeRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, READ_PERMISSIONS)
  const userId = userIdOf(request)
  const holder = await deps.unitOfWork.execute((tx) => readNominee(tx, deps, userId))
  return reply.sendData(nomineeBody(holder), { status: 200 })
}

const changeNominee = async (deps: AdminNomineeRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, WRITE_PERMISSIONS)
  const userId = userIdOf(request)
  const body = parseOrThrow(changeBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const nominee = nomineeOf(body)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, NOMINEE_ROUTE, key),
    requestHash: hashRequest({ userId, nominee, expectedVersion: body.expectedVersion }),
    execute: async (tx) => {
      const outcome = await changeClientNominee(tx, deps, {
        userId,
        nominee,
        expectedVersion: body.expectedVersion,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 200, body: { ...nomineeBody(outcome.holder), status: outcome.status } }
    },
  })

  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerAdminNomineeRoutes = (application: FastifyInstance, deps: AdminNomineeRouteDeps): void => {
  application.get(NOMINEE_ROUTE, (request, reply) => getNominee(deps, request, reply))
  application.post(NOMINEE_ROUTE, (request, reply) => changeNominee(deps, request, reply))
}
