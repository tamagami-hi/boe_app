import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { newMerchantRefundId } from "../domain/payments/merchantIds.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { PaymentGateway } from "../providers/phonepe/paymentGateway.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { InvestmentReviewRepository, ReviewQueueRow } from "../repositories/investmentReviewRepository.js"
import type { PaymentsRepository, PaymentListRow } from "../repositories/paymentsRepository.js"
import type { RefundRepository, RefundListRow } from "../repositories/refundRepository.js"
import {
  adminIdempotencyScope,
  hashRequest,
  iso,
  isoOrNull,
  limitSchema,
  reasonCodeSchema,
  reasonDetailSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const REVIEWS_ROUTE = "/v1/admin/investment-reviews"
const REFUNDS_ROUTE = "/v1/admin/refunds"
const PAYMENTS_ROUTE = "/v1/admin/payments"

export interface AdminInvestmentReviewConfig {
  readonly idempotencyTtlMs: number
}

export interface AdminInvestmentReviewDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: AdminInvestmentReviewConfig
  readonly reviewRepository: InvestmentReviewRepository
  readonly paymentsRepository: PaymentsRepository
  readonly refundRepository: RefundRepository
  readonly paymentGateway: PaymentGateway
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

const queueQuerySchema = z
  .object({ state: z.enum(["pending", "accepted", "rejected"]).default("pending"), limit: limitSchema })
  .strict()

const acceptBodySchema = z
  .object({
    bankVerified: z.literal(true),
    expectedVersion: z.coerce.number().int().min(1),
    privateNote: reasonDetailSchema.optional(),
  })
  .strict()

const rejectBodySchema = z
  .object({
    reasonCode: reasonCodeSchema,
    expectedVersion: z.coerce.number().int().min(1),
    privateNote: reasonDetailSchema.optional(),
  })
  .strict()

const refundsQuerySchema = z
  .object({
    state: z.enum(["pending", "provider_pending", "refunded", "failed", "all"]).default("failed"),
    limit: limitSchema,
  })
  .strict()

const paymentsQuerySchema = z.object({ limit: limitSchema }).strict()

const mapQueueRow = (row: ReviewQueueRow): Record<string, unknown> => ({
  orderId: row.orderId,
  client: { id: row.userId, name: row.clientName, email: row.clientEmail },
  amountPaise: row.amountPaise,
  currency: row.currency,
  selectedFund: { id: row.fundId, name: row.fundName, versionId: row.fundVersionId, state: row.fundState },
  payment: {
    id: row.paymentId,
    state: row.paymentState,
    provider: "phonepe",
    merchantOrderId: row.merchantOrderId,
    providerReference: row.providerReference,
    succeededAt: isoOrNull(row.succeededAt),
  },
  review: {
    id: row.reviewId,
    state: row.reviewState,
    reasonCode: row.reasonCode,
    reviewedAt: isoOrNull(row.reviewedAt),
    version: Number(row.reviewVersion),
  },
  createdAt: iso(row.createdAt),
})

const mapRefundRow = (row: RefundListRow): Record<string, unknown> => ({
  id: row.id,
  orderId: row.orderId,
  paymentId: row.paymentId,
  merchantRefundId: row.merchantRefundId,
  providerRefundId: row.providerRefundId,
  amountPaise: row.amountPaise,
  state: row.state,
  failureCode: row.failureCode,
  attemptCount: row.attemptCount,
  client: { name: row.clientName, email: row.clientEmail },
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

const mapPaymentRow = (row: PaymentListRow): Record<string, unknown> => ({
  id: row.id,
  orderId: row.orderId,
  userId: row.userId,
  userEmail: row.userEmail,
  amountPaise: row.amountPaise,
  status: row.status,
  provider: row.provider,
  providerReference: row.providerReference,
  attemptCount: row.attemptCount,
  succeededAt: isoOrNull(row.succeededAt),
  failedAt: isoOrNull(row.failedAt),
  createdAt: iso(row.createdAt),
})

const listQueue = async (deps: AdminInvestmentReviewDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["investments.review.read", "investments.review.write"])
  const query = parseOrThrow(queueQuerySchema, request.query)

  const rows = await deps.reviewRepository.findQueuePage(deps.database, {
    state: query.state,
    limit: query.limit,
  })
  return reply.sendData({ items: rows.map(mapQueueRow) }, { status: 200 })
}

const getDetail = async (deps: AdminInvestmentReviewDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["investments.review.read", "investments.review.write"])
  const orderId = parseOrThrow(uuidParam, (request.params as { orderId?: unknown }).orderId)

  const row = await deps.reviewRepository.findDetailByOrder(deps.database, orderId)
  if (row === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData(mapQueueRow(row), { status: 200 })
}

const acceptReview = async (deps: AdminInvestmentReviewDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["investments.review.write"])
  const orderId = parseOrThrow(uuidParam, (request.params as { orderId?: unknown }).orderId)
  const body = parseOrThrow(acceptBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${REVIEWS_ROUTE}/:orderId/accept`, key),
    requestHash: hashRequest({ orderId, ...body }),
    execute: async (tx) => {
      const order = await deps.reviewRepository.lockOrderById(tx, orderId)
      if (order === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (order.state !== "review_pending") throw new AppError("STATE_CONFLICT")

      const review = await deps.reviewRepository.lockReviewByOrder(tx, orderId)
      if (review === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (review.state !== "pending") throw new AppError("STATE_CONFLICT")
      if (Number(review.version) !== body.expectedVersion) throw new AppError("STATE_CONFLICT")

      const payment = await deps.reviewRepository.lockPaymentByOrder(tx, orderId)
      if (payment === null || payment.state !== "succeeded") throw new AppError("STATE_CONFLICT")

      const fundState = await deps.reviewRepository.findFundState(tx, order.fund_id)
      if (fundState === null || fundState === "archived") throw new AppError("STATE_CONFLICT")

      if (await deps.reviewRepository.hasAllocation(tx, orderId)) throw new AppError("STATE_CONFLICT")

      const now = deps.clock()
      const acceptedReview = await deps.reviewRepository.markAccepted(tx, {
        reviewId: review.id,
        reviewerUserId: principal.userId,
        privateNote: body.privateNote ?? null,
        now,
      })
      if (acceptedReview === null) throw new AppError("STATE_CONFLICT")

      const allocation = await deps.reviewRepository.insertAllocation(tx, {
        orderId,
        userId: order.user_id,
        fundId: order.fund_id,
        amountPaise: payment.amount_paise,
        allocatedByUserId: principal.userId,
        allocatedAt: now,
        requestId: request.requestId,
      })

      await deps.reviewRepository.insertContribution(tx, {
        userId: order.user_id,
        fundId: order.fund_id,
        allocationId: allocation.id,
        amountPaise: payment.amount_paise,
        effectiveDate: now.toISOString().slice(0, 10),
        orderId,
        paymentId: payment.id,
        reasonCode: "investment_accepted",
        createdByUserId: principal.userId,
        requestId: request.requestId,
      })

      const acceptedOrder = await deps.reviewRepository.markOrderAccepted(tx, orderId, now)
      if (acceptedOrder === null) throw new AppError("STATE_CONFLICT")

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "investment_review.accept",
        entityType: "investment_order",
        entityId: orderId,
        requestId: request.requestId,
        entityVersion: Number(acceptedOrder.version),
        metadata: {
          fundId: order.fund_id,
          userId: order.user_id,
          amountPaise: payment.amount_paise,
          allocationId: allocation.id,
        },
      })

      return { status: 200, body: { orderId, state: "accepted", acceptedAt: iso(now) } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const rejectReview = async (deps: AdminInvestmentReviewDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["investments.review.write"])
  const orderId = parseOrThrow(uuidParam, (request.params as { orderId?: unknown }).orderId)
  const body = parseOrThrow(rejectBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${REVIEWS_ROUTE}/:orderId/reject`, key),
    requestHash: hashRequest({ orderId, ...body }),
    execute: async (tx) => {
      const order = await deps.reviewRepository.lockOrderById(tx, orderId)
      if (order === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (order.state !== "review_pending") throw new AppError("STATE_CONFLICT")

      const review = await deps.reviewRepository.lockReviewByOrder(tx, orderId)
      if (review === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (review.state !== "pending") throw new AppError("STATE_CONFLICT")
      if (Number(review.version) !== body.expectedVersion) throw new AppError("STATE_CONFLICT")

      const payment = await deps.reviewRepository.lockPaymentByOrder(tx, orderId)
      if (payment === null || payment.state !== "succeeded") throw new AppError("STATE_CONFLICT")

      const now = deps.clock()
      const rejectedReview = await deps.reviewRepository.markRejected(tx, {
        reviewId: review.id,
        reviewerUserId: principal.userId,
        reasonCode: body.reasonCode,
        privateNote: body.privateNote ?? null,
        now,
      })
      if (rejectedReview === null) throw new AppError("STATE_CONFLICT")

      const refundPendingOrder = await deps.reviewRepository.markOrderRefundPending(tx, orderId, now)
      if (refundPendingOrder === null) throw new AppError("STATE_CONFLICT")

      const refundPendingPayment = await deps.paymentsRepository.markPaymentRefundPending(tx, payment.id, now)
      if (refundPendingPayment === null) throw new AppError("STATE_CONFLICT")

      const refund = await deps.refundRepository.create(tx, {
        paymentId: payment.id,
        orderId,
        merchantRefundId: newMerchantRefundId(),
        amountPaise: payment.amount_paise,
        createdByUserId: principal.userId,
        requestId: request.requestId,
      })

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "investment_review.reject",
        entityType: "investment_order",
        entityId: orderId,
        requestId: request.requestId,
        entityVersion: Number(refundPendingOrder.version),
        metadata: { fundId: order.fund_id, userId: order.user_id, reasonCode: body.reasonCode, refundId: refund.id },
      })

      return { status: 200, body: { orderId, state: "refund_pending", refundId: refund.id } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const listRefunds = async (deps: AdminInvestmentReviewDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["refunds.write", "investments.review.read"])
  const query = parseOrThrow(refundsQuerySchema, request.query)

  const rows = await deps.refundRepository.listPage(deps.database, {
    states: query.state === "all" ? [] : [query.state],
    limit: query.limit,
  })
  return reply.sendData({ items: rows.map(mapRefundRow) }, { status: 200 })
}

const listPayments = async (deps: AdminInvestmentReviewDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["payments.read", "investments.review.read"])
  const query = parseOrThrow(paymentsQuerySchema, request.query)

  const rows = await deps.paymentsRepository.listPage(deps.database, { limit: query.limit })
  return reply.sendData({ items: rows.map(mapPaymentRow) }, { status: 200 })
}

const retryRefund = async (deps: AdminInvestmentReviewDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["refunds.write"])
  const refundId = parseOrThrow(uuidParam, (request.params as { refundId?: unknown }).refundId)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${REFUNDS_ROUTE}/:refundId/retry`, key),
    requestHash: hashRequest({ refundId }),
    execute: async (tx) => {
      const refund = await deps.refundRepository.lockById(tx, refundId)
      if (refund === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (refund.state !== "failed") throw new AppError("STATE_CONFLICT")

      const requeued = await deps.refundRepository.requeue(tx, refundId, deps.clock())
      if (requeued === null) throw new AppError("STATE_CONFLICT")

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "refund.retry",
        entityType: "refund_operation",
        entityId: refundId,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: { orderId: refund.order_id },
      })

      return { status: 200, body: { refundId, state: "pending" } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const reconcileRefund = async (deps: AdminInvestmentReviewDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["refunds.write"])
  const refundId = parseOrThrow(uuidParam, (request.params as { refundId?: unknown }).refundId)
  const key = requireIdempotencyKey(request)

  const target = await deps.unitOfWork.execute((tx) => deps.refundRepository.lockById(tx, refundId))
  if (target === null) throw new AppError("RESOURCE_NOT_FOUND")

  let status: "refunded" | "failed" | "pending"
  try {
    const fact = await deps.paymentGateway.getRefundStatus(target.merchant_refund_id)
    status = fact.outcome === "succeeded" ? "refunded" : fact.outcome === "failed" ? "failed" : "pending"
  } catch {
    status = "pending"
  }

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${REFUNDS_ROUTE}/:refundId/reconcile`, key),
    requestHash: hashRequest({ refundId }),
    execute: async (tx) => {
      const refund = await deps.refundRepository.lockById(tx, refundId)
      if (refund === null) throw new AppError("RESOURCE_NOT_FOUND")
      const now = deps.clock()

      if (status === "refunded") {
        const refunded = await deps.refundRepository.markRefunded(tx, {
          refundId,
          providerRefundId: refund.provider_refund_id,
          now,
        })
        if (refunded !== null) {
          await deps.paymentsRepository.markPaymentRefunded(tx, refund.payment_id, now)
          await deps.paymentsRepository.markOrderRefunded(tx, refund.order_id, now)
        }
      } else if (status === "failed") {
        const failed = await deps.refundRepository.markFailed(tx, {
          refundId,
          failureCode: "PROVIDER_REFUND_FAILED",
          now,
        })
        if (failed !== null) {
          await deps.paymentsRepository.markPaymentRefundFailed(tx, refund.payment_id, now)
          await deps.paymentsRepository.markOrderRefundFailed(tx, {
            orderId: refund.order_id,
            failureCode: "PROVIDER_REFUND_FAILED",
            now,
          })
        }
      } else {
        await deps.refundRepository.markStatusChecked(tx, { refundId, now })
      }

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "refund.reconcile",
        entityType: "refund_operation",
        entityId: refundId,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: { orderId: refund.order_id, providerState: status },
      })

      return { status: 200, body: { refundId, state: status } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

export const registerAdminInvestmentReviewRoutes = (
  application: FastifyInstance,
  deps: AdminInvestmentReviewDeps,
): void => {
  application.get(REVIEWS_ROUTE, (request, reply) => listQueue(deps, request, reply))
  application.get(`${REVIEWS_ROUTE}/:orderId`, (request, reply) => getDetail(deps, request, reply))
  application.post(`${REVIEWS_ROUTE}/:orderId/accept`, (request, reply) => acceptReview(deps, request, reply))
  application.post(`${REVIEWS_ROUTE}/:orderId/reject`, (request, reply) => rejectReview(deps, request, reply))
  application.get(REFUNDS_ROUTE, (request, reply) => listRefunds(deps, request, reply))
  application.post(`${REFUNDS_ROUTE}/:refundId/retry`, (request, reply) => retryRefund(deps, request, reply))
  application.post(`${REFUNDS_ROUTE}/:refundId/reconcile`, (request, reply) => reconcileRefund(deps, request, reply))
  application.get(PAYMENTS_ROUTE, (request, reply) => listPayments(deps, request, reply))
}
