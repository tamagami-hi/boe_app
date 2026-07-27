/**
 * Client order write routes (spec 04 §3; spec 03 §5.2, §6). Native bearer
 * transport: every handler resolves and re-checks the native principal. Both
 * mutations require an `Idempotency-Key` and run under the database idempotency
 * protocol, so a replay returns the first committed result without a second side
 * effect.
 *
 *   POST /v1/client/orders            create a one-time purchase order
 *   POST /v1/client/orders/:id/pay    begin payment for a submitted order
 */
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, IdempotencyScope } from "../db/repositories.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import { beginPayment, type BeginPaymentConfig } from "../domain/client/beginPayment.js"
import { createOrder } from "../domain/client/createOrder.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent, idempotencyKeySchema } from "../http/idempotencyProtocol.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { OrderWriteRepository } from "../repositories/orderRepository.js"
import type { OutboxWriteRepository } from "../repositories/outboxRepository.js"
import type { PaymentWriteRepository } from "../repositories/paymentRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"

export interface ClientOrderConfig extends BeginPaymentConfig {
  readonly idempotencyTtlMs: number
}

export interface ClientOrderDeps extends NativeRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly orderRepository: OrderWriteRepository
  readonly paymentRepository: PaymentWriteRepository
  readonly userRepository: UserWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: ClientOrderConfig
}

const ORDERS_ROUTE = "/v1/client/orders"

const createOrderBodySchema = z
  .object({ fundId: z.string().uuid(), amountPaise: z.number().int().positive() })
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

const postCreateOrder = async (deps: ClientOrderDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const idempotencyKey = requireIdempotencyKey(request)
  const body = parseOrThrow(createOrderBodySchema, request.body)
  const amountPaise = String(body.amountPaise)
  const now = deps.clock()

  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: userScope(principal.userId, ORDERS_ROUTE, idempotencyKey),
      requestHash: hashRequest({ fundId: body.fundId, amountPaise }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const order = await createOrder(
          tx,
          {
            orderRepository: deps.orderRepository,
            userRepository: deps.userRepository,
            auditRepository: deps.auditRepository,
            clock: deps.clock,
          },
          { userId: principal.userId, fundId: body.fundId, amountPaise, requestId: request.requestId },
        )
        return {
          status: 201,
          body: {
            orderId: order.id,
            fundId: order.fund_id,
            type: order.type,
            status: order.state,
            amountPaise: order.amount_paise,
            currency: order.currency,
            version: Number(order.version),
            createdAt: iso(order.created_at),
          },
        }
      },
    }),
  )
  return reply.sendData(outcome.body, {
    status: outcome.status,
    ...(outcome.replay ? { idempotencyReplay: true } : {}),
  })
}

const postBeginPayment = async (deps: ClientOrderDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const orderId = parseOrThrow(uuidParam, (request.params as { orderId?: unknown }).orderId)
  const idempotencyKey = requireIdempotencyKey(request)
  const now = deps.clock()

  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: userScope(principal.userId, `${ORDERS_ROUTE}/:id/pay`, idempotencyKey),
      requestHash: hashRequest({ orderId }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const result = await beginPayment(
          tx,
          {
            orderRepository: deps.orderRepository,
            paymentRepository: deps.paymentRepository,
            outboxRepository: deps.outboxRepository,
            auditRepository: deps.auditRepository,
            clock: deps.clock,
            config: { paymentProvider: deps.config.paymentProvider, attemptTtlMs: deps.config.attemptTtlMs },
          },
          { userId: principal.userId, orderId, requestId: request.requestId },
        )
        return {
          status: 202,
          body: {
            orderId: result.order.id,
            status: result.order.state,
            paymentId: result.payment.id,
            paymentAttemptId: result.attempt.id,
            provider: result.attempt.provider,
            amountPaise: result.payment.amount_paise,
            currency: result.payment.currency,
            version: Number(result.order.version),
          },
        }
      },
    }),
  )
  return reply.sendData(outcome.body, {
    status: outcome.status,
    ...(outcome.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerClientOrderRoutes = (application: FastifyInstance, deps: ClientOrderDeps): void => {
  application.post(ORDERS_ROUTE, async (request, reply) => postCreateOrder(deps, request, reply))
  application.post(`${ORDERS_ROUTE}/:orderId/pay`, async (request, reply) => postBeginPayment(deps, request, reply))
}
