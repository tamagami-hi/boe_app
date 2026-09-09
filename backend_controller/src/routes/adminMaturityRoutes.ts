import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, Transaction } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  markPositionMatured,
  reinvestMaturedPosition,
  updateWithdrawalPayout,
  withdrawMaturedPosition,
  type MaturitySettlementDeps,
} from "../domain/admin/maturitySettlement.js"
import { AdminMarkMaturityBody, AdminPayoutStatusBody, AdminReinvestmentBody, AdminWithdrawalBody } from "./adminMaturitySchemas.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { parseOrThrow } from "../http/validation.js"
import {
  adminIdempotencyScope,
  hashRequest,
  limitSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const MATURITIES_ROUTE = "/v1/admin/clients/:userId/maturities"
const WITHDRAWAL_ROUTE = `${MATURITIES_ROUTE}/:maturityId/withdrawal`
const REINVESTMENT_ROUTE = `${MATURITIES_ROUTE}/:maturityId/reinvestment`
const PAYOUTS_ROUTE = "/v1/admin/clients/:userId/withdrawal-payouts"
const PAYOUT_STATUS_ROUTE = `${PAYOUTS_ROUTE}/:payoutId/status`
const READ_PERMISSIONS = ["client_position.write", "client_values.read"]
const userParams = z.strictObject({ userId: uuidParam })
const maturityParams = userParams.extend({ maturityId: uuidParam })
const payoutParams = userParams.extend({ payoutId: uuidParam })
const listQuery = z.strictObject({ limit: limitSchema })

export interface AdminMaturityDeps extends MaturitySettlementDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: Readonly<{ idempotencyTtlMs: number }>
}

type MutationContext = Readonly<{ actorUserId: string; requestId: string }>
type MutationResult = Readonly<{ status: number; body: Readonly<Record<string, unknown>> }>

const mutate = async (
  deps: AdminMaturityDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  parseCommand: (context: MutationContext) => Readonly<{
    hash: Readonly<Record<string, unknown>>
    execute: (tx: Transaction) => Promise<MutationResult>
  }>,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["client_position.write"])
  const key = requireIdempotencyKey(request)
  const command = parseCommand({ actorUserId: principal.userId, requestId: request.requestId })
  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, route, key),
    requestHash: hashRequest(command.hash),
    execute: command.execute,
  })
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const markMatured = (deps: AdminMaturityDeps, request: FastifyRequest, reply: FastifyReply) =>
  mutate(deps, request, reply, MATURITIES_ROUTE, (context) => {
    const params = parseOrThrow(userParams, request.params)
    const body = parseOrThrow(AdminMarkMaturityBody, request.body)
    return {
      hash: { ...params, ...body },
      execute: async (tx) => ({
        status: 201,
        body: await markPositionMatured(tx, deps, { ...context, ...params, ...body, note: body.note ?? null }),
      }),
    }
  })

const settle = (
  deps: AdminMaturityDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  isWithdrawal: boolean,
) => mutate(deps, request, reply, isWithdrawal ? WITHDRAWAL_ROUTE : REINVESTMENT_ROUTE, (context) => {
  const params = parseOrThrow(maturityParams, request.params)
  const withdrawalBody = isWithdrawal ? parseOrThrow(AdminWithdrawalBody, request.body) : null
  const body = withdrawalBody ?? parseOrThrow(AdminReinvestmentBody, request.body)
  return {
    hash: { ...params, ...body },
    execute: async (tx) => {
      const input = { ...context, ...params, ...body, note: body.note ?? null }
      const result = withdrawalBody !== null
        ? await withdrawMaturedPosition(tx, deps, { ...input, amountPaise: BigInt(withdrawalBody.amountPaise) })
        : await reinvestMaturedPosition(tx, deps, input)
      return {
        status: 201,
        body: {
          entryId: result.entryId,
          payoutId: result.payoutId,
          principalPaise: result.principalPaise.toString(),
          currentValuePaise: result.currentValuePaise.toString(),
          principalDeltaPaise: result.principalDeltaPaise.toString(),
          valueDeltaPaise: result.valueDeltaPaise.toString(),
        },
      }
    },
  }
})

const updatePayout = (deps: AdminMaturityDeps, request: FastifyRequest, reply: FastifyReply) =>
  mutate(deps, request, reply, PAYOUT_STATUS_ROUTE, (context) => {
    const params = parseOrThrow(payoutParams, request.params)
    const body = parseOrThrow(AdminPayoutStatusBody, request.body)
    return {
      hash: { ...params, ...body },
      execute: async (tx) => {
        await updateWithdrawalPayout(tx, deps, {
          ...context,
          ...params,
          ...body,
          transferReference: body.state === "paid" ? body.transferReference : null,
          failureCode: body.state === "failed" ? body.failureCode : null,
        })
        return { status: 200, body: { payoutId: params.payoutId, state: body.state } }
      },
    }
  })

const listMaturities = async (deps: AdminMaturityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, READ_PERMISSIONS)
  const { userId } = parseOrThrow(userParams, request.params)
  const query = parseOrThrow(listQuery, request.query)
  const rows = await deps.maturityRepository.listMaturities(deps.database, { userId, limit: query.limit })
  return reply.sendData({
    userId,
    items: rows.map((row) => ({
      ...row,
      principalAtMaturityPaise: row.principalAtMaturityPaise.toString(),
      valueAtMaturityPaise: row.valueAtMaturityPaise.toString(),
    })),
  })
}

const listPayouts = async (deps: AdminMaturityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, READ_PERMISSIONS)
  const { userId } = parseOrThrow(userParams, request.params)
  const query = parseOrThrow(listQuery, request.query)
  const rows = await deps.maturityRepository.listWithdrawalPayouts(deps.database, { userId, limit: query.limit })
  return reply.sendData({
    userId,
    items: rows.map((row) => ({
      ...row,
      amountPaise: row.amountPaise.toString(),
      growthPortionPaise: row.growthPortionPaise.toString(),
      principalPortionPaise: row.principalPortionPaise.toString(),
      createdAt: row.createdAt.toISOString(),
    })),
  })
}

export const registerAdminMaturityRoutes = (application: FastifyInstance, deps: AdminMaturityDeps): void => {
  application.get(MATURITIES_ROUTE, (request, reply) => listMaturities(deps, request, reply))
  application.get(PAYOUTS_ROUTE, (request, reply) => listPayouts(deps, request, reply))
  application.post(MATURITIES_ROUTE, (request, reply) => markMatured(deps, request, reply))
  application.post(WITHDRAWAL_ROUTE, (request, reply) => settle(deps, request, reply, true))
  application.post(REINVESTMENT_ROUTE, (request, reply) => settle(deps, request, reply, false))
  application.post(PAYOUT_STATUS_ROUTE, (request, reply) => updatePayout(deps, request, reply))
}
