/**
 * Client SIP routes (spec 04 §3; spec 03 §5.2). Native bearer transport; every
 * mutation requires an `Idempotency-Key` and runs under the database idempotency
 * protocol.
 *
 *   POST /v1/client/sips                 create a SIP (draft)
 *   POST /v1/client/sips/:id/mandate     request the debit mandate (-> pending_mandate)
 *   POST /v1/client/sips/:id/pause       pause an active SIP
 *   POST /v1/client/sips/:id/resume      resume a paused SIP
 *   POST /v1/client/sips/:id/cancel      cancel a SIP (revokes an unshared mandate)
 */
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, IdempotencyScope, SipPlan } from "../db/repositories.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import {
  cancelSip,
  createSip,
  pauseSip,
  requestSipMandate,
  resumeSip,
} from "../domain/client/sip.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent, idempotencyKeySchema } from "../http/idempotencyProtocol.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { MandateWriteRepository } from "../repositories/mandateRepository.js"
import type { OrderWriteRepository } from "../repositories/orderRepository.js"
import type { OutboxWriteRepository } from "../repositories/outboxRepository.js"
import type { SipWriteRepository } from "../repositories/sipRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"

export interface ClientSipConfig {
  readonly idempotencyTtlMs: number
  readonly paymentProvider: string
  readonly mandateFrequency: string
}

export interface ClientSipDeps extends NativeRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly sipRepository: SipWriteRepository
  readonly mandateRepository: MandateWriteRepository
  readonly orderRepository: OrderWriteRepository
  readonly userRepository: UserWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: ClientSipConfig
}

const SIPS_ROUTE = "/v1/client/sips"

const createSipBodySchema = z
  .object({
    fundId: z.string().uuid(),
    amountPaise: z.number().int().positive(),
    debitDay: z.number().int().min(1).max(28),
    durationMonths: z.number().int().positive().optional(),
  })
  .strict()
const uuidParam = z.string().uuid()

const iso = (value: Date | string): string => new Date(value).toISOString()

const requireIdempotencyKey = (request: FastifyRequest): string => {
  const header = request.headers["idempotency-key"]
  const value = Array.isArray(header) ? header[0] : header
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "idempotency-key": ["a valid Idempotency-Key header is required"] },
    })
  }
  return parsed.data
}

const hashRequest = (canonical: Readonly<Record<string, unknown>>): Buffer =>
  createHash("sha256").update(JSON.stringify(canonical)).digest()

const userScope = (userId: string, routeTemplate: string, key: string): IdempotencyScope => ({
  actorScope: `user:${userId}`,
  actorScopeKeyVersion: null,
  candidateActorScopes: [`user:${userId}`],
  method: "POST",
  routeTemplate,
  key,
})

const sipBody = (sip: SipPlan): Record<string, unknown> => ({
  sipId: sip.id,
  fundId: sip.fund_id,
  status: sip.state,
  amountPaise: sip.amount_paise,
  debitDay: sip.debit_day,
  durationMonths: sip.duration_months,
  mandateId: sip.mandate_id,
  nextDueDate: sip.next_due_date,
  version: Number(sip.version),
  createdAt: iso(sip.created_at),
})

const postCreateSip = async (deps: ClientSipDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const idempotencyKey = requireIdempotencyKey(request)
  const body = parseOrThrow(createSipBodySchema, request.body)
  const amountPaise = String(body.amountPaise)
  const now = deps.clock()

  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: userScope(principal.userId, SIPS_ROUTE, idempotencyKey),
      requestHash: hashRequest({
        fundId: body.fundId,
        amountPaise,
        debitDay: body.debitDay,
        durationMonths: body.durationMonths ?? null,
      }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const sip = await createSip(
          tx,
          {
            sipRepository: deps.sipRepository,
            orderRepository: deps.orderRepository,
            userRepository: deps.userRepository,
            auditRepository: deps.auditRepository,
            clock: deps.clock,
          },
          {
            userId: principal.userId,
            fundId: body.fundId,
            amountPaise,
            debitDay: body.debitDay,
            durationMonths: body.durationMonths ?? null,
            requestId: request.requestId,
          },
        )
        return { status: 201, body: sipBody(sip) }
      },
    }),
  )
  return reply.sendData(outcome.body, {
    status: outcome.status,
    ...(outcome.replay ? { idempotencyReplay: true } : {}),
  })
}

const postRequestMandate = async (deps: ClientSipDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const sipId = parseOrThrow(uuidParam, (request.params as { sipId?: unknown }).sipId)
  const idempotencyKey = requireIdempotencyKey(request)
  const now = deps.clock()

  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: userScope(principal.userId, `${SIPS_ROUTE}/:id/mandate`, idempotencyKey),
      requestHash: hashRequest({ sipId }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const result = await requestSipMandate(
          tx,
          {
            sipRepository: deps.sipRepository,
            mandateRepository: deps.mandateRepository,
            outboxRepository: deps.outboxRepository,
            auditRepository: deps.auditRepository,
            clock: deps.clock,
            config: { paymentProvider: deps.config.paymentProvider, mandateFrequency: deps.config.mandateFrequency },
          },
          { userId: principal.userId, sipId, requestId: request.requestId },
        )
        return {
          status: 202,
          body: { ...sipBody(result.sip), mandateId: result.mandate.id, mandateStatus: result.mandate.state },
        }
      },
    }),
  )
  return reply.sendData(outcome.body, {
    status: outcome.status,
    ...(outcome.replay ? { idempotencyReplay: true } : {}),
  })
}

type ControlCommand = (
  tx: Parameters<typeof pauseSip>[0],
  deps: Parameters<typeof pauseSip>[1],
  input: Readonly<{ userId: string; sipId: string; requestId: string }>,
) => Promise<SipPlan>

const runControl = async (
  deps: ClientSipDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  routeTemplate: string,
  command: ControlCommand,
) => {
  const principal = await authenticateNativeRequest(request, deps)
  const sipId = parseOrThrow(uuidParam, (request.params as { sipId?: unknown }).sipId)
  const idempotencyKey = requireIdempotencyKey(request)
  const now = deps.clock()

  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: userScope(principal.userId, routeTemplate, idempotencyKey),
      requestHash: hashRequest({ sipId, routeTemplate }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const sip = await command(
          tx,
          {
            sipRepository: deps.sipRepository,
            mandateRepository: deps.mandateRepository,
            auditRepository: deps.auditRepository,
            clock: deps.clock,
          },
          { userId: principal.userId, sipId, requestId: request.requestId },
        )
        return { status: 200, body: sipBody(sip) }
      },
    }),
  )
  return reply.sendData(outcome.body, {
    status: outcome.status,
    ...(outcome.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerClientSipRoutes = (application: FastifyInstance, deps: ClientSipDeps): void => {
  application.post(SIPS_ROUTE, async (request, reply) => postCreateSip(deps, request, reply))
  application.post(`${SIPS_ROUTE}/:sipId/mandate`, async (request, reply) => postRequestMandate(deps, request, reply))
  application.post(`${SIPS_ROUTE}/:sipId/pause`, async (request, reply) =>
    runControl(deps, request, reply, `${SIPS_ROUTE}/:id/pause`, pauseSip),
  )
  application.post(`${SIPS_ROUTE}/:sipId/resume`, async (request, reply) =>
    runControl(deps, request, reply, `${SIPS_ROUTE}/:id/resume`, resumeSip),
  )
  application.post(`${SIPS_ROUTE}/:sipId/cancel`, async (request, reply) =>
    runControl(deps, request, reply, `${SIPS_ROUTE}/:id/cancel`, cancelSip),
  )
}
