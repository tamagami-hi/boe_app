import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  recordContribution,
  type RecordContributionDeps,
} from "../domain/admin/recordContribution.js"
import {
  reverseLedgerEntry,
  type ReverseLedgerEntryDeps,
} from "../domain/admin/reverseLedgerEntry.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import {
  adminIdempotencyScope,
  hashRequest,
  limitSchema,
  reasonCodeSchema,
  reasonDetailSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const RECORDED_CONTRIBUTIONS_ROUTE = "/v1/admin/clients/:userId/recorded-contributions"
const LEDGER_ENTRIES_ROUTE = "/v1/admin/clients/:userId/ledger-entries"
const REVERSAL_ROUTE = "/v1/admin/clients/:userId/ledger-entries/:entryId/reversal"

const WRITE_PERMISSION = "client_position.write"
const READ_PERMISSIONS = ["client_position.write", "client_values.read"] as const

export interface AdminClientPositionConfig {
  readonly idempotencyTtlMs: number
}

export interface AdminClientPositionDeps extends RecordContributionDeps, ReverseLedgerEntryDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: AdminClientPositionConfig
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "must be a YYYY-MM-DD date")

const positivePaiseSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{0,18}$/u, "must be a positive integer paise string")

const recordedContributionSchema = z
  .object({
    fundId: uuidParam,
    amountPaise: positivePaiseSchema,
    effectiveDate: dateSchema,
    reasonCode: reasonCodeSchema,
    note: reasonDetailSchema.optional(),
  })
  .strict()

const reversalSchema = z
  .object({ reasonCode: reasonCodeSchema, note: reasonDetailSchema.optional() })
  .strict()

const ledgerQuerySchema = z
  .object({ fundId: uuidParam.optional(), limit: limitSchema })
  .strict()

const userIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)

const entryIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as { entryId?: unknown }).entryId)

const assertNotFuture = (effectiveDate: string, now: Date): void => {
  if (effectiveDate > now.toISOString().slice(0, 10)) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { effectiveDate: ["A past investment cannot be dated in the future."] },
    })
  }
}

const recordedContribution = async (
  deps: AdminClientPositionDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [WRITE_PERMISSION])
  const userId = userIdOf(request)
  const body = parseOrThrow(recordedContributionSchema, request.body)
  const key = requireIdempotencyKey(request)
  const now = deps.clock()
  assertNotFuture(body.effectiveDate, now)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now,
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, RECORDED_CONTRIBUTIONS_ROUTE, key),
    requestHash: hashRequest({
      userId,
      fundId: body.fundId,
      amountPaise: body.amountPaise,
      effectiveDate: body.effectiveDate,
      reasonCode: body.reasonCode,
      ...(body.note === undefined ? {} : { note: body.note }),
    }),
    execute: async (tx) => {
      const recorded = await recordContribution(tx, deps, {
        userId,
        fundId: body.fundId,
        amountPaise: BigInt(body.amountPaise),
        effectiveDate: body.effectiveDate,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return {
        status: 201,
        body: {
          entryId: recorded.entryId,
          userId,
          fundId: body.fundId,
          orderId: recorded.orderId,
          paymentId: recorded.paymentId,
          allocationId: recorded.allocationId,
          fundVersionId: recorded.fundVersionId,
          fundVersionEffectiveOnDate: recorded.fundVersionHistorical,
          amountPaise: body.amountPaise,
          effectiveDate: body.effectiveDate,
          reasonCode: body.reasonCode,
          principalPaise: recorded.principalPaise.toString(),
          currentValuePaise: recorded.currentValuePaise.toString(),
        },
      }
    },
  })

  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const ledgerEntries = async (
  deps: AdminClientPositionDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...READ_PERMISSIONS])
  const userId = userIdOf(request)
  const query = parseOrThrow(ledgerQuerySchema, request.query)

  const rows = await deps.clientPositionRepository.listLedgerEntries(deps.database, {
    userId,
    fundId: query.fundId ?? null,
    limit: query.limit,
  })

  return reply.sendData(
    {
      userId,
      items: rows.map((row) => ({
        entryId: row.id,
        fundId: row.fundId,
        entryType: row.entryType,
        orderType: row.orderType,
        principalDeltaPaise: row.principalDeltaPaise.toString(),
        valueDeltaPaise: row.valueDeltaPaise.toString(),
        effectiveDate: row.effectiveDate,
        reasonCode: row.reasonCode,
        reversesEntryId: row.reversesEntryId,
        reversedByEntryId: row.reversedByEntryId,
        reversible: row.entryType !== "reversal" && row.reversedByEntryId === null,
        createdAt: row.createdAt.toISOString(),
      })),
    },
    { status: 200 },
  )
}

const reversal = async (
  deps: AdminClientPositionDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [WRITE_PERMISSION])
  const userId = userIdOf(request)
  const entryId = entryIdOf(request)
  const body = parseOrThrow(reversalSchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, REVERSAL_ROUTE, key),
    requestHash: hashRequest({
      userId,
      entryId,
      reasonCode: body.reasonCode,
      ...(body.note === undefined ? {} : { note: body.note }),
    }),
    execute: async (tx) => {
      const reversed = await reverseLedgerEntry(tx, deps, {
        userId,
        entryId,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return {
        status: 201,
        body: {
          entryId: reversed.reversalEntryId,
          reversedEntryId: reversed.reversedEntryId,
          userId,
          fundId: reversed.fundId,
          effectiveDate: reversed.effectiveDate,
          principalDeltaPaise: reversed.principalDeltaPaise.toString(),
          valueDeltaPaise: reversed.valueDeltaPaise.toString(),
          reasonCode: body.reasonCode,
          principalPaise: reversed.principalPaise.toString(),
          currentValuePaise: reversed.currentValuePaise.toString(),
        },
      }
    },
  })

  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerAdminClientPositionRoutes = (
  application: FastifyInstance,
  deps: AdminClientPositionDeps,
): void => {
  application.get(LEDGER_ENTRIES_ROUTE, (request, reply) => ledgerEntries(deps, request, reply))
  application.post(RECORDED_CONTRIBUTIONS_ROUTE, (request, reply) =>
    recordedContribution(deps, request, reply),
  )
  application.post(REVERSAL_ROUTE, (request, reply) => reversal(deps, request, reply))
}
