import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { computeFilterHash } from "../http/cursor.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { PaymentGateway } from "../providers/paymentGateway.js"
import { logGatewayFailure } from "../providers/gatewayFailure.js"
import { isRefundEvidenceCorrelated } from "../domain/payments/refundEvidence.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type {
  FundReceiptAcknowledgementRepository,
  FundReceiptQueueRow,
} from "../repositories/fundReceiptAcknowledgementRepository.js"
import type { NotificationWriteRepository } from "../repositories/notificationRepository.js"
import type { InvestmentSettlementRepository } from "../repositories/investmentSettlementRepository.js"
import type { PaymentsRepository, PaymentListRow } from "../repositories/paymentsRepository.js"
import type { RefundRepository, RefundListRow } from "../repositories/refundRepository.js"
import {
  adminIdempotencyScope,
  hashRequest,
  iso,
  isoOrNull,
  limitSchema,
  reasonDetailSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const FUND_RECEIPTS_ROUTE = "/v1/admin/fund-receipts"
const REFUNDS_ROUTE = "/v1/admin/refunds"
const PAYMENTS_ROUTE = "/v1/admin/payments"

export interface AdminFundReceiptConfig {
  readonly cursorKey: Buffer
  readonly idempotencyTtlMs: number
}

export interface AdminFundReceiptDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: AdminFundReceiptConfig
  readonly acknowledgementRepository: FundReceiptAcknowledgementRepository
  readonly paymentsRepository: PaymentsRepository
  readonly settlementRepository: InvestmentSettlementRepository
  readonly refundRepository: RefundRepository
  readonly paymentGateway: PaymentGateway | null
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly notificationRepository: NotificationWriteRepository
}

export const queueQuerySchema = z
  .object({
    state: z.enum(["pending", "acknowledged"]).default("pending"),
    after: z.string().min(1).optional(),
    limit: limitSchema,
  })
  .strict()

const acknowledgeBodySchema = z
  .object({
    expectedVersion: z.coerce.number().int().min(1),
    privateNote: reasonDetailSchema.optional(),
  })
  .strict()

const ACKNOWLEDGEMENT_TITLE = "Funds acknowledged"
const ACKNOWLEDGEMENT_BODY = "Your funds have been acknowledged by BeOnEdge LLP and are ready for investment. Please stay updated through our app."

export const refundsQuerySchema = z
  .object({
    state: z.enum(["pending", "provider_pending", "refunded", "failed", "all"]).default("failed"),
    after: z.string().min(1).optional(),
    limit: limitSchema,
  })
  .strict()

export const paymentsQuerySchema = z
  .object({ after: z.string().min(1).optional(), limit: limitSchema })
  .strict()

const mapQueueRow = (row: FundReceiptQueueRow): Record<string, unknown> => ({
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
  acknowledgement: {
    id: row.acknowledgementId,
    state: row.acknowledgementState,
    acknowledgedAt: isoOrNull(row.acknowledgedAt),
    privateNote: row.privateNote,
    version: Number(row.acknowledgementVersion),
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

const listQueue = async (deps: AdminFundReceiptDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["funds.receipts.read", "funds.receipts.write"])
  const query = parseOrThrow(queueQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ state: query.state })
  const keyset = readKeyset(deps.config.cursorKey, query.after, FUND_RECEIPTS_ROUTE, filterHash, now)

  const rows = await deps.acknowledgementRepository.findQueuePage(deps.database, {
    state: query.state,
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    FUND_RECEIPTS_ROUTE,
    filterHash,
    now,
    (row) => [iso(row.createdAt), row.acknowledgementId],
  )
  return reply.sendData({ items: items.map(mapQueueRow) }, { status: 200, page })
}

const getDetail = async (deps: AdminFundReceiptDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["funds.receipts.read", "funds.receipts.write"])
  const orderId = parseOrThrow(uuidParam, (request.params as { orderId?: unknown }).orderId)

  const row = await deps.acknowledgementRepository.findDetailByOrder(deps.database, orderId)
  if (row === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData(mapQueueRow(row), { status: 200 })
}

const acknowledgeFunds = async (deps: AdminFundReceiptDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.receipts.write"])
  const orderId = parseOrThrow(uuidParam, (request.params as { orderId?: unknown }).orderId)
  const body = parseOrThrow(acknowledgeBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${FUND_RECEIPTS_ROUTE}/:orderId/acknowledge`, key),
    requestHash: hashRequest({ orderId, ...body }),
    execute: async (tx) => {
      const order = await deps.acknowledgementRepository.lockOrderById(tx, orderId)
      if (order === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (order.state !== "accepted") throw new AppError("STATE_CONFLICT")

      const acknowledgement = await deps.acknowledgementRepository.lockAcknowledgementByOrder(tx, orderId)
      if (acknowledgement === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (acknowledgement.state !== "pending") throw new AppError("STATE_CONFLICT")
      if (Number(acknowledgement.version) !== body.expectedVersion) throw new AppError("STATE_CONFLICT")

      const payment = await deps.acknowledgementRepository.lockPaymentByOrder(tx, orderId)
      if (payment === null || payment.state !== "succeeded") throw new AppError("STATE_CONFLICT")
      if (!await deps.settlementRepository.hasCompletedInvestmentSettlement(tx, {
        orderId,
        paymentId: payment.id,
      })) throw new AppError("STATE_CONFLICT")

      const now = deps.clock()
      const acknowledged = await deps.acknowledgementRepository.markAcknowledged(tx, {
        acknowledgementId: acknowledgement.id,
        acknowledgedByUserId: principal.userId,
        privateNote: body.privateNote ?? null,
        now,
      })
      if (acknowledged === null) throw new AppError("STATE_CONFLICT")

      await deps.notificationRepository.create(tx, {
        userId: order.user_id,
        kind: "fund_receipt_acknowledged",
        title: ACKNOWLEDGEMENT_TITLE,
        body: ACKNOWLEDGEMENT_BODY,
        payload: { orderId, paymentId: payment.id, fundId: order.fund_id, deepLink: "/app/portfolio" },
      })

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "investment_funds.acknowledge",
        entityType: "fund_receipt_acknowledgement",
        entityId: acknowledged.id,
        requestId: request.requestId,
        entityVersion: Number(acknowledged.version),
        metadata: { fundId: order.fund_id, userId: order.user_id, paymentId: payment.id },
      })

      return { status: 200, body: { orderId, state: "acknowledged", acknowledgedAt: iso(now) } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const listRefunds = async (deps: AdminFundReceiptDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["funds.receipts.read", "refunds.write"])
  const query = parseOrThrow(refundsQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ state: query.state })
  const keyset = readKeyset(deps.config.cursorKey, query.after, REFUNDS_ROUTE, filterHash, now)

  const rows = await deps.refundRepository.listPage(deps.database, {
    states: query.state === "all" ? [] : [query.state],
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    REFUNDS_ROUTE,
    filterHash,
    now,
    (row) => [iso(row.createdAt), row.id],
  )
  return reply.sendData({ items: items.map(mapRefundRow) }, { status: 200, page })
}

const listPayments = async (deps: AdminFundReceiptDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["payments.read"])
  const query = parseOrThrow(paymentsQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({})
  const keyset = readKeyset(deps.config.cursorKey, query.after, PAYMENTS_ROUTE, filterHash, now)

  const rows = await deps.paymentsRepository.listPage(deps.database, {
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    PAYMENTS_ROUTE,
    filterHash,
    now,
    (row) => [iso(row.createdAt), row.id],
  )
  return reply.sendData({ items: items.map(mapPaymentRow) }, { status: 200, page })
}

const retryRefund = async (deps: AdminFundReceiptDeps, request: FastifyRequest, reply: FastifyReply) => {
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

      const now = deps.clock()
      const requeued = await deps.refundRepository.requeue(tx, refundId, now)
      if (requeued === null) throw new AppError("STATE_CONFLICT")
      if (await deps.paymentsRepository.requeuePaymentRefund(tx, refund.payment_id, now) === null) {
        throw new AppError("STATE_CONFLICT")
      }
      if (await deps.paymentsRepository.requeueOrderRefund(tx, refund.order_id, now) === null) {
        throw new AppError("STATE_CONFLICT")
      }

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

const reconcileRefund = async (deps: AdminFundReceiptDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["refunds.write"])
  const refundId = parseOrThrow(uuidParam, (request.params as { refundId?: unknown }).refundId)
  const key = requireIdempotencyKey(request)
  const paymentGateway = deps.paymentGateway
  if (paymentGateway === null) throw new AppError("DEPENDENCY_UNAVAILABLE")

  const target = await deps.unitOfWork.execute((tx) => deps.refundRepository.lockById(tx, refundId))
  if (target === null) throw new AppError("RESOURCE_NOT_FOUND")

  let fact: Awaited<ReturnType<PaymentGateway["getRefundStatus"]>>
  try {
    fact = await paymentGateway.getRefundStatus(target.merchant_refund_id)
  } catch (error) {
    logGatewayFailure(request.log, error, { requestId: request.requestId, operation: "get_refund_status" })
    throw new AppError("DEPENDENCY_UNAVAILABLE")
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
      const attempt = await deps.paymentsRepository.latestAttempt(tx, refund.payment_id)
      if (
        attempt === null || attempt.state !== "succeeded" ||
        fact.merchantRefundId !== refund.merchant_refund_id ||
        !isRefundEvidenceCorrelated({
          expectedAmountPaise: refund.amount_paise,
          expectedMerchantOrderId: attempt.merchant_order_id,
          expectedProviderRefundId: refund.provider_refund_id,
          providerRefundId: fact.providerRefundId,
          amountPaise: fact.amountPaise,
          originalMerchantOrderId: fact.originalMerchantOrderId,
        })
      ) throw new AppError("STATE_CONFLICT")
      const now = deps.clock()
      const status = fact.outcome === "succeeded" ? "refunded" : fact.outcome === "failed" ? "failed" : "pending"

      if (status === "refunded") {
        const refunded = await deps.refundRepository.markRefunded(tx, {
          refundId,
          providerRefundId: fact.providerRefundId,
          now,
        })
        if (refunded === null) throw new AppError("STATE_CONFLICT")
        if (await deps.paymentsRepository.markPaymentRefunded(tx, refund.payment_id, now) === null) {
          throw new AppError("STATE_CONFLICT")
        }
        if (await deps.paymentsRepository.markOrderRefunded(tx, refund.order_id, now) === null) {
          throw new AppError("STATE_CONFLICT")
        }
      } else if (status === "failed") {
        const failed = await deps.refundRepository.markFailed(tx, {
          refundId,
          failureCode: "PROVIDER_REFUND_FAILED",
          now,
        })
        if (failed === null) throw new AppError("STATE_CONFLICT")
        if (await deps.paymentsRepository.markPaymentRefundFailed(tx, refund.payment_id, now) === null) {
          throw new AppError("STATE_CONFLICT")
        }
        if (await deps.paymentsRepository.markOrderRefundFailed(tx, {
          orderId: refund.order_id,
          failureCode: "PROVIDER_REFUND_FAILED",
          now,
        }) === null) throw new AppError("STATE_CONFLICT")
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

export const registerAdminFundReceiptRoutes = (
  application: FastifyInstance,
  deps: AdminFundReceiptDeps,
): void => {
  application.get(FUND_RECEIPTS_ROUTE, (request, reply) => listQueue(deps, request, reply))
  application.get(`${FUND_RECEIPTS_ROUTE}/:orderId`, (request, reply) => getDetail(deps, request, reply))
  application.post(`${FUND_RECEIPTS_ROUTE}/:orderId/acknowledge`, (request, reply) => acknowledgeFunds(deps, request, reply))
  application.get(REFUNDS_ROUTE, (request, reply) => listRefunds(deps, request, reply))
  application.post(`${REFUNDS_ROUTE}/:refundId/retry`, (request, reply) => retryRefund(deps, request, reply))
  application.post(`${REFUNDS_ROUTE}/:refundId/reconcile`, (request, reply) => reconcileRefund(deps, request, reply))
  application.get(PAYMENTS_ROUTE, (request, reply) => listPayments(deps, request, reply))
}
