/**
 * Client order write routes. Native bearer transport: every handler resolves and
 * re-checks the native principal. The mutation requires an `Idempotency-Key` and
 * runs under the database idempotency protocol, so a replay returns the first
 * committed result without a second side effect.
 *
 *   POST /v1/client/orders              create a lump-sum order for a published fund
 *   POST /v1/client/orders/:orderId/pay begin (or resume) a PhonePe checkout
 *
 * Amounts travel as decimal paise strings (integer money never crosses the wire
 * as a float). Order responses expose only the client-safe status projection
 * (spec §9.2), never the raw internal state enum.
 *
 * `/pay` is the two-transaction checkout orchestrator (spec §7): transaction A
 * persists the payment/attempt and a stable `merchantOrderId`; the PhonePe adapter
 * call happens after that transaction commits; transaction B persists the
 * checkout result. A crash between the provider call and transaction B is recovered
 * by a retry that reuses the same non-terminal attempt and asks PhonePe for its
 * status before ever creating a second one — the whole point of the stable id.
 */
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, IdempotencyScope, Transaction } from "../db/repositories.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { createOrder } from "../domain/client/createOrder.js"
import { projectOrderStatus } from "../domain/client/clientStatus.js"
import { newMerchantOrderId } from "../domain/payments/merchantIds.js"
import { checkoutSecondsRemaining } from "../domain/payments/checkoutExpiry.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent } from "../http/idempotencyProtocol.js"
import { parseOrThrow } from "../http/validation.js"
import type { PaymentGateway } from "../providers/phonepe/paymentGateway.js"
import { logGatewayFailure, logGatewayUnconfigured } from "../providers/phonepe/gatewayFailure.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { OrderWriteRepository } from "../repositories/orderRepository.js"
import type { PaymentsRepository } from "../repositories/paymentsRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"
import { requireIdempotencyKey } from "./adminRouteKit.js"

export interface ClientOrderConfig {
  readonly idempotencyTtlMs: number
  readonly attemptTtlMs: number
}

export interface ClientOrderDeps extends ClientRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly orderRepository: OrderWriteRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly paymentsRepository: PaymentsRepository
  /** Null when PhonePe is unconfigured; `/pay` fails closed rather than stub out a checkout. */
  readonly paymentGateway: PaymentGateway | null
  readonly config: ClientOrderConfig
}

const ORDERS_ROUTE = "/v1/client/orders"
const PAY_ROUTE = "/v1/client/orders/:orderId/pay"
/** Attempt states from which /pay may still act instead of creating a new attempt. */
const ATTEMPT_OPEN_STATES = new Set(["created", "provider_pending"])

const createOrderBodySchema = z
  .object({
    fundId: z.string().uuid(),
    /** Integer paise as a decimal string; a created order always pins an amount. */
    amountPaise: z.string().regex(/^[1-9][0-9]*$/u),
  })
  .strict()

const iso = (value: Date | string): string => new Date(value).toISOString()

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
  const principal = await resolveClientPrincipal(request, deps)
  const idempotencyKey = requireIdempotencyKey(request)
  const body = parseOrThrow(createOrderBodySchema, request.body)
  const now = deps.clock()

  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: userScope(principal.userId, ORDERS_ROUTE, idempotencyKey),
      requestHash: hashRequest({ fundId: body.fundId, amountPaise: body.amountPaise }),
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
          {
            userId: principal.userId,
            fundId: body.fundId,
            amountPaise: body.amountPaise,
            requestId: request.requestId,
          },
        )
        return {
          status: 201,
          body: {
            orderId: order.id,
            fundId: order.fund_id,
            type: order.type,
            // Client-safe projection: a new order is awaiting payment.
            status: "payment_in_progress",
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

const payParamsSchema = z.object({ orderId: z.string().uuid() }).strict()
const payBodySchema = z.object({
  checkoutChannel: z.literal("hosted_redirect"),
}).strict()

type CheckoutChannel = z.infer<typeof payBodySchema>["checkoutChannel"]

const postPay = async (deps: ClientOrderDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const params = parseOrThrow(payParamsSchema, request.params)
  const body = parseOrThrow(payBodySchema, request.body ?? {})
  if (deps.paymentGateway === null) {
    logGatewayUnconfigured(request.log, { requestId: request.requestId, operation: "create_checkout" })
    throw new AppError("DEPENDENCY_UNAVAILABLE")
  }
  const idempotencyKey = requireIdempotencyKey(request)
  const now = deps.clock()

  // Transaction A: lock the order, transition it into payment_pending, ensure a
  // payment row exists, and reuse or create the attempt that carries the stable
  // merchantOrderId. Runs under the idempotency protocol so a replayed call
  // with the same key returns the first committed attempt rather than minting
  // a second one.
  const prepared = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: userScope(principal.userId, PAY_ROUTE, idempotencyKey),
      requestHash: hashRequest({ orderId: params.orderId, checkoutChannel: body.checkoutChannel }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: () => prepareAttempt(
        deps,
        tx,
        principal.userId,
        params.orderId,
        body.checkoutChannel,
        now,
        request.requestId,
      ),
    }),
  )
  if (prepared.replay && prepared.body.terminal === true) {
    // A prior call already resolved this order past payment (e.g. it is now in
    // review); nothing left to dispatch, hand back the current safe status.
    return reply.sendData(prepared.body, { status: prepared.status, idempotencyReplay: true })
  }

  const merchantOrderId = prepared.body.merchantOrderId as string
  const attemptId = prepared.body.attemptId as string
  const paymentId = prepared.body.paymentId as string
  const orderId = params.orderId
  const preparedCheckoutExpiresAt = new Date(prepared.body.checkoutExpiresAt as string)
  const remainingCheckoutSeconds = checkoutSecondsRemaining(preparedCheckoutExpiresAt, deps.clock())
  if (remainingCheckoutSeconds === null) throw new AppError("STATE_CONFLICT")
  const dispatchClaim = await deps.unitOfWork.execute((tx) =>
    deps.paymentsRepository.markAttemptDispatchStarted(tx, attemptId, deps.clock()),
  )
  if (dispatchClaim === null) {
    const currentAttempt = await deps.unitOfWork.execute((tx) =>
      deps.paymentsRepository.lockAttemptById(tx, attemptId),
    )
    if (currentAttempt === null || !ATTEMPT_OPEN_STATES.has(currentAttempt.state)) {
      throw new AppError("STATE_CONFLICT")
    }
    return reply.sendData({
      orderId,
      paymentId,
      provider: "phonepe",
      status: "payment_in_progress",
      checkout: null,
      expiresAt: iso(currentAttempt.checkout_expires_at as Date | string),
    }, { status: 200, ...(prepared.replay ? { idempotencyReplay: true } : {}) })
  }
  let checkout
  try {
    checkout = await deps.paymentGateway.createCheckout({
      merchantOrderId,
      amountPaise: prepared.body.amountPaise as string,
      redirectUrl: null,
      expireAfterSeconds: remainingCheckoutSeconds,
    })
  } catch (error) {
    logGatewayFailure(request.log, error, { requestId: request.requestId, operation: "create_checkout" })
    throw new AppError("DEPENDENCY_UNAVAILABLE", { cause: error })
  }

  const providerExpiry = checkout.expiresAt ?? preparedCheckoutExpiresAt
  const expiresAt = providerExpiry.getTime() < preparedCheckoutExpiresAt.getTime()
    ? providerExpiry
    : preparedCheckoutExpiresAt
  if (expiresAt.getTime() <= deps.clock().getTime()) throw new AppError("DEPENDENCY_UNAVAILABLE")
  await deps.unitOfWork.execute(async (tx) => {
    const attempt = await deps.paymentsRepository.markAttemptDispatched(tx, {
      attemptId,
      providerOrderId: checkout.providerOrderId,
      checkoutExpiresAt: expiresAt,
      now: deps.clock(),
    })
    if (attempt === null) throw new AppError("STATE_CONFLICT")
    const payment = await deps.paymentsRepository.markPaymentProviderPending(tx, paymentId, deps.clock())
    if (payment === null) throw new AppError("STATE_CONFLICT")
  })
  return reply.sendData({
    orderId,
    paymentId,
    provider: "phonepe",
    status: "payment_in_progress",
    checkout: { type: "redirect", url: checkout.redirectUrl },
    expiresAt: iso(expiresAt),
  }, { status: 200, ...(prepared.replay ? { idempotencyReplay: true } : {}) })
}

/**
 * Transaction A body: lock the order, ensure payment_pending, and reuse a
 * still-open attempt or create a new one with a fresh stable merchantOrderId.
 * Terminal order states (already past payment) return their current safe
 * status instead of creating a new attempt.
 */
const prepareAttempt = async (
  deps: ClientOrderDeps,
  tx: Transaction,
  userId: string,
  orderId: string,
  checkoutChannel: CheckoutChannel,
  now: Date,
  requestId: string,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> => {
  const order = await deps.paymentsRepository.lockOrderForPayment(tx, { orderId, userId })
  if (order === null) throw new AppError("RESOURCE_NOT_FOUND")

  if (order.state !== "submitted" && order.state !== "payment_pending" && order.state !== "payment_failed") {
    // Already past the point where a new checkout makes sense (in review,
    // accepted, refunding, ...); hand back the current safe status.
    return {
      status: 200,
      body: { orderId: order.id, status: projectOrderStatus(order.state), terminal: true },
    }
  }

  const movedOrder = await deps.paymentsRepository.markOrderPaymentPending(tx, orderId, now)
  const currentOrder = movedOrder ?? order

  let payment = await deps.paymentsRepository.lockPaymentByOrder(tx, orderId)
  payment ??= await deps.paymentsRepository.createPayment(tx, {
    orderId,
    userId,
    amountPaise: currentOrder.amount_paise,
    currency: currentOrder.currency,
  })

  let latest = await deps.paymentsRepository.latestAttempt(tx, payment.id)
  if (latest !== null && ATTEMPT_OPEN_STATES.has(latest.state)) {
    if (latest.checkout_channel !== checkoutChannel) throw new AppError("STATE_CONFLICT")
    // Crash/replay recovery: reuse the still-open attempt's stable id rather
    // than mint a second merchantOrderId for the same payment.
    return {
      status: 200,
      body: {
        merchantOrderId: latest.merchant_order_id,
        attemptId: latest.id,
        paymentId: payment.id,
        amountPaise: payment.amount_paise,
        checkoutExpiresAt: iso(latest.checkout_expires_at as Date | string),
      },
    }
  }

  if (payment.state === "failed" || payment.state === "expired") {
    const retriedPayment = await deps.paymentsRepository.markPaymentRetryCreated(tx, payment.id, now)
    if (retriedPayment === null) throw new AppError("STATE_CONFLICT")
    payment = retriedPayment
  }

  const createdAttempt = await deps.paymentsRepository.createAttempt(tx, {
    paymentId: payment.id,
    userId,
    attemptNumber: (latest?.attempt_number ?? 0) + 1,
    merchantOrderId: newMerchantOrderId(),
    checkoutExpiresAt: new Date(now.getTime() + deps.config.attemptTtlMs),
    checkoutChannel,
  })
  const attempt = createdAttempt
  await deps.auditRepository.append(tx, {
    actorType: "system",
    actorUserId: null,
    command: "client_order.pay",
    entityType: "payment_attempt",
    entityId: attempt.id,
    requestId,
    entityVersion: 1,
    metadata: { orderId, paymentId: payment.id },
  })

  return {
    status: 200,
    body: {
      merchantOrderId: attempt.merchant_order_id,
      attemptId: attempt.id,
      paymentId: payment.id,
      amountPaise: payment.amount_paise,
      checkoutExpiresAt: iso(attempt.checkout_expires_at ?? new Date(now.getTime() + deps.config.attemptTtlMs)),
    },
  }
}

export const registerClientOrderRoutes = (application: FastifyInstance, deps: ClientOrderDeps): void => {
  application.post(ORDERS_ROUTE, async (request, reply) => postCreateOrder(deps, request, reply))
  application.post(PAY_ROUTE, async (request, reply) => postPay(deps, request, reply))
}
