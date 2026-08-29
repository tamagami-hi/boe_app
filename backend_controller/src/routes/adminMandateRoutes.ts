import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, IdempotencyScope, PaymentAttempt, Transaction } from "../db/repositories.js"
import type {
  Database,
  MandateCancelCommandState,
  MandateNotifyState,
  MandateSetupState,
  MandateState,
} from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { reconcileCollectionFact } from "../domain/payments/reconcileCollectionFact.js"
import { reconcileMandateFact, type MandateFactDeps } from "../domain/payments/reconcileMandateFacts.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeysetValues } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import { logGatewayFailure } from "../providers/phonepe/gatewayFailure.js"
import type { RecurringPaymentGateway } from "../providers/recurringPaymentGateway.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { PaymentsRepository } from "../repositories/paymentsRepository.js"
import type { InvestmentSettlementRepository } from "../repositories/investmentSettlementRepository.js"
import type { AdminMandateRepository, AdminMandateListRow } from "../repositories/adminMandateRepository.js"
import type { MandatesRepository } from "../repositories/mandatesRepository.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  iso,
  isoOrNull,
  limitSchema,
  reasonDetailSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

const replayIfCompleted = async <TBody extends Record<string, unknown>>(
  deps: Pick<AdminMandateDeps, "unitOfWork" | "idempotencyRepository">,
  scope: IdempotencyScope,
  requestHash: Buffer,
): Promise<{ readonly status: number; readonly body: TBody } | null> => {
  const completed = await deps.unitOfWork.execute((tx) => deps.idempotencyRepository.findCompleted(tx, scope))
  if (completed === null) return null
  const storedHash = completed.request_hash as unknown as Uint8Array
  if (!equalBytes(storedHash, requestHash)) {
    throw new AppError("IDEMPOTENCY_KEY_REUSED")
  }
  const storedBody: unknown = typeof completed.response_body === "string"
    ? JSON.parse(completed.response_body) as unknown
    : completed.response_body
  return { status: completed.response_status, body: storedBody as TBody }
}

const paymentStateFromAttempt = (attempt: PaymentAttempt | null): "succeeded" | "failed" | null => {
  if (attempt?.state === "succeeded") return "succeeded"
  if (attempt?.state === "failed") return "failed"
  return null
}

const MANDATES_ROUTE = "/v1/admin/mandates"
const COLLECTIONS_ROUTE = "/v1/admin/mandate-collections"

const ATTENTION_MANDATE_STATES: readonly MandateState[] = [
  "setup_pending",
  "active",
  "pause_pending",
  "paused",
  "cancel_pending",
  "revoke_pending",
]

const PENDING_SETUP_STATES: readonly MandateSetupState[] = ["created", "dispatching", "provider_pending"]
const PENDING_COLLECTION_STATES: readonly MandateNotifyState[] = ["created", "dispatching"]
const PENDING_CANCEL_STATES: readonly MandateCancelCommandState[] = ["queued", "dispatching", "reconciliation_required"]

export interface AdminMandateConfig {
  readonly cursorKey: Buffer
  readonly idempotencyTtlMs: number
}

export interface AdminMandateDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: AdminMandateConfig
  readonly adminMandateRepository: AdminMandateRepository
  readonly mandatesRepository: MandatesRepository
  readonly paymentsRepository: PaymentsRepository
  readonly settlementRepository: InvestmentSettlementRepository
  readonly recurringPaymentGateway: RecurringPaymentGateway | null
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

const listQuerySchema = z
  .object({
    limit: limitSchema,
    state: z.enum([
      "setup_pending",
      "active",
      "pause_pending",
      "paused",
      "cancel_pending",
      "cancelled",
      "revoke_pending",
      "revoked",
      "expired",
      "failed",
    ] as const).optional(),
    attention: z.enum(["true", "false"] as const).optional(),
    after: z.string().optional(),
  })
  .strict()

const reasonBodySchema = z
  .object({
    reason: reasonDetailSchema,
  })
  .strict()

const computeAttentionReason = (row: AdminMandateListRow): string | null => {
  if (ATTENTION_MANDATE_STATES.includes(row.mandateState)) {
    return `Mandate requires attention: ${row.mandateState}`
  }
  if (row.setupState !== null && PENDING_SETUP_STATES.includes(row.setupState)) {
    return "Setup attempt in progress"
  }
  if (row.collectionState !== null && PENDING_COLLECTION_STATES.includes(row.collectionState)) {
    return "Collection attempt in progress"
  }
  if (row.cancelState !== null && PENDING_CANCEL_STATES.includes(row.cancelState)) {
    return "Cancellation in progress"
  }
  return null
}

const mapListRow = (row: AdminMandateListRow): Record<string, unknown> => ({
  mandateId: row.id,
  sipPlanId: row.sipPlanId,
  userId: row.userId,
  userEmail: row.userEmail,
  userName: row.userName,
  fundId: row.fundId,
  fundName: row.fundName,
  amountPaise: Number(row.amountPaise),
  debitDay: row.debitDay,
  sipState: row.sipState,
  mandateState: row.mandateState,
  setupState: row.setupState,
  collectionState: row.collectionState,
  cancelState: row.cancelState,
  latestDuePeriod: row.latestDuePeriod,
  attentionReason: computeAttentionReason(row),
  lastStatusCheckedAt: isoOrNull(row.lastStatusCheckedAt),
  updatedAt: iso(row.updatedAt),
})

const buildDetailResponse = (
  detail: NonNullable<Awaited<ReturnType<AdminMandateRepository["findMandateDetail"]>>>,
  userName: string | null,
  userEmail: string | null,
  fundName: string | null,
): Record<string, unknown> => ({
  mandate: {
    mandateId: detail.mandate.id,
    sipPlanId: detail.mandate.sip_plan_id,
    userId: detail.mandate.user_id,
    fundId: detail.mandate.fund_id,
    amountPaise: Number(detail.mandate.max_amount_paise),
    state: detail.mandate.state,
    merchantSubscriptionId: detail.mandate.merchant_subscription_id,
    providerSubscriptionId: detail.mandate.provider_subscription_id,
    failureCode: detail.mandate.failure_code,
    lastStatusCheckedAt: isoOrNull(detail.mandate.last_status_checked_at),
    updatedAt: iso(detail.mandate.updated_at),
  },
  user: {
    id: detail.mandate.user_id,
    name: userName,
    email: userEmail,
  },
  fund: {
    id: detail.mandate.fund_id,
    name: fundName,
  },
  sip: {
    id: detail.sip.id,
    state: detail.sip.state,
    collectionMode: detail.sip.collection_mode,
    debitDay: detail.sip.debit_day,
  },
  setupAttempts: detail.setupAttempts.map((attempt) => ({
    setupAttemptId: attempt.id,
    state: attempt.state,
    orderId: attempt.order_id,
    paymentId: attempt.payment_id,
    paymentAttemptId: attempt.payment_attempt_id,
    providerOrderId: attempt.provider_order_id,
    failureCode: attempt.failure_code,
    expiresAt: iso(attempt.setup_expires_at),
    lastStatusCheckedAt: isoOrNull(attempt.last_status_checked_at),
    updatedAt: iso(attempt.updated_at),
  })),
  collectionAttempts: detail.collectionAttempts.map((attempt) => ({
    collectionId: attempt.id,
    duePeriod: attempt.due_period.toISOString().slice(0, 10),
    amountPaise: Number(attempt.amount_paise),
    notifyState: attempt.notify_state,
    paymentState: null,
    orderId: attempt.order_id,
    paymentId: attempt.payment_id,
    paymentAttemptId: attempt.payment_attempt_id,
    scheduledDebitAt: iso(attempt.scheduled_debit_at),
    notifiedAt: isoOrNull(attempt.notified_at),
    failureCode: attempt.notify_failure_code,
    updatedAt: iso(attempt.updated_at),
  })),
  cancelCommands: detail.cancelCommands.map((command) => ({
    commandId: command.id,
    state: command.state,
    failureCode: command.failure_code,
    createdAt: iso(command.created_at),
    updatedAt: iso(command.updated_at),
  })),
})

const fetchUserAndFundNames = async (
  tx: Transaction,
  userId: string,
  fundId: string,
): Promise<{ readonly userName: string | null; readonly userEmail: string | null; readonly fundName: string | null }> => {
  const user = await tx
    .selectFrom("users")
    .select(["email_normalized", "full_name"])
    .where("id", "=", userId)
    .executeTakeFirst()
  const fund = await tx
    .selectFrom("funds")
    .leftJoin("fund_versions", "fund_versions.id", "funds.current_published_version_id")
    .select("fund_versions.name")
    .where("funds.id", "=", fundId)
    .executeTakeFirst()
  return {
    userName: user?.full_name ?? null,
    userEmail: user?.email_normalized ?? null,
    fundName: fund?.name ?? null,
  }
}

const listMandates = async (deps: AdminMandateDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["payments.read"])
  const query = parseOrThrow(listQuerySchema, request.query)

  const now = deps.clock()
  const filterHash = computeFilterHash({ state: query.state ?? null, attention: query.attention ?? null })
  const afterValues = readKeysetValues(
    deps.config.cursorKey,
    query.after,
    MANDATES_ROUTE,
    filterHash,
    now,
  )
  const afterUpdatedAt = afterValues[0]
  const afterId = afterValues[1]
  const afterPosition =
    afterUpdatedAt === undefined || afterId === undefined
      ? undefined
      : { updatedAt: new Date(afterUpdatedAt), id: afterId }

  const listInput = {
    /*
     * One row past the page so `paginate` can tell whether another page exists;
     * without the over-fetch every response claimed to be the last one.
     */
    limit: query.limit + 1,
    attention: query.attention === "true",
    ...(query.state === undefined ? {} : { state: query.state }),
    ...(afterPosition === undefined ? {} : { after: afterPosition }),
  }
  const rows = await deps.adminMandateRepository.listMandates(deps.database, listInput)
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    MANDATES_ROUTE,
    filterHash,
    now,
    (row) => [iso(row.updatedAt), row.id],
  )
  return reply.sendData({ items: items.map(mapListRow) }, { status: 200, page })
}

const getMandateDetail = async (deps: AdminMandateDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["payments.read"])
  const mandateId = parseOrThrow(uuidParam, (request.params as { mandateId?: unknown }).mandateId)

  const detail = await deps.adminMandateRepository.findMandateDetail(deps.database, mandateId)
  if (detail === null) throw new AppError("RESOURCE_NOT_FOUND")
  const names = await fetchUserAndFundNames(deps.database, detail.mandate.user_id, detail.mandate.fund_id)
  return reply.sendData(buildDetailResponse(detail, names.userName, names.userEmail, names.fundName), { status: 200 })
}

const reconcileMandate = async (deps: AdminMandateDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["finance.operate"])
  const mandateId = parseOrThrow(uuidParam, (request.params as { mandateId?: unknown }).mandateId)
  const body = parseOrThrow(reasonBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  if (deps.recurringPaymentGateway === null) {
    throw new AppError("DEPENDENCY_UNAVAILABLE")
  }
  const gateway = deps.recurringPaymentGateway

  const scope = adminIdempotencyScope(principal.userId, `${MANDATES_ROUTE}/:mandateId/reconcile`, key)
  const requestHash = hashRequest({ mandateId, reason: body.reason })

  const replay = await replayIfCompleted<Record<string, unknown>>(deps, scope, requestHash)
  if (replay !== null) {
    return reply.sendData(replay.body, { status: replay.status, idempotencyReplay: true })
  }

  const mandate = await deps.adminMandateRepository.findMandateDetail(deps.database, mandateId)
  if (mandate === null) throw new AppError("RESOURCE_NOT_FOUND")

  const factDeps: MandateFactDeps = {
    unitOfWork: deps.unitOfWork,
    mandatesRepository: deps.mandatesRepository,
    paymentsRepository: deps.paymentsRepository,
    settlementRepository: deps.settlementRepository,
  }

  let providerState: string | null = null
  let status: Awaited<ReturnType<RecurringPaymentGateway["getMandateStatus"]>> | null = null
  if (mandate.mandate.provider_subscription_id !== null) {
    try {
      status = await gateway.getMandateStatus(mandate.mandate.merchant_subscription_id)
    } catch (error) {
      logGatewayFailure(request.log, error, { requestId: request.requestId, operation: "get_mandate_status" })
      throw new AppError("DEPENDENCY_UNAVAILABLE")
    }
    providerState = status.state
  }

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope,
    requestHash,
    execute: async (tx) => {
      if (status !== null) {
        await reconcileMandateFact(factDeps, status, deps.clock())
      }
      const updated = await deps.adminMandateRepository.findMandateDetail(tx, mandateId)
      if (updated === null) throw new AppError("RESOURCE_NOT_FOUND")
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "mandate.reconcile",
        entityType: "payment_mandate",
        entityId: mandateId,
        requestId: request.requestId,
        entityVersion: Number(updated.mandate.version),
        metadata: {
          merchantSubscriptionId: mandate.mandate.merchant_subscription_id,
          providerState,
          reason: body.reason,
          skipped: mandate.mandate.provider_subscription_id === null,
        },
      })
      const names = await fetchUserAndFundNames(tx, updated.mandate.user_id, updated.mandate.fund_id)
      return { status: 200, body: buildDetailResponse(updated, names.userName, names.userEmail, names.fundName) }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const reconcileCollection = async (deps: AdminMandateDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["finance.operate"])
  const collectionId = parseOrThrow(uuidParam, (request.params as { collectionId?: unknown }).collectionId)
  const body = parseOrThrow(reasonBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  if (deps.recurringPaymentGateway === null) {
    throw new AppError("DEPENDENCY_UNAVAILABLE")
  }
  const gateway = deps.recurringPaymentGateway

  const scope = adminIdempotencyScope(principal.userId, `${COLLECTIONS_ROUTE}/:collectionId/reconcile`, key)
  const requestHash = hashRequest({ collectionId, reason: body.reason })

  type CollectionReconcileBody = {
    readonly collectionId: string
    readonly mandateId: string
    readonly state: string
    readonly paymentState: string | null
    readonly providerState: string
  }

  const replay = await replayIfCompleted<CollectionReconcileBody>(deps, scope, requestHash)
  if (replay !== null) {
    return reply.sendData(replay.body, { status: replay.status, idempotencyReplay: true })
  }

  const collection = await deps.mandatesRepository.findCollectionAttemptForAdmin(deps.database, collectionId)
  if (collection === null) throw new AppError("RESOURCE_NOT_FOUND")

  const paymentAttempt = await deps.paymentsRepository.findAttemptById(deps.database, collection.payment_attempt_id)
  if (paymentAttempt === null) throw new AppError("RESOURCE_NOT_FOUND")

  let fact: Awaited<ReturnType<RecurringPaymentGateway["getCollectionStatus"]>>
  try {
    fact = await gateway.getCollectionStatus(paymentAttempt.merchant_order_id)
  } catch (error) {
    logGatewayFailure(request.log, error, { requestId: request.requestId, operation: "get_collection_status" })
    throw new AppError("DEPENDENCY_UNAVAILABLE")
  }

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope,
    requestHash,
    execute: async (tx) => {
      await reconcileCollectionFact(tx, {
        mandatesRepository: deps.mandatesRepository,
        paymentsRepository: deps.paymentsRepository,
        settlementRepository: deps.settlementRepository,
      }, fact, deps.clock())
      const updated = await deps.mandatesRepository.markCollectionAttemptReconciled(tx, {
        attemptId: collectionId,
        now: deps.clock(),
      })
      if (updated === null) throw new AppError("RESOURCE_NOT_FOUND")
      const paymentAttemptAfter = await deps.paymentsRepository.findAttemptById(tx, collection.payment_attempt_id)
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "mandate_collection.reconcile",
        entityType: "mandate_collection_attempt",
        entityId: collectionId,
        requestId: request.requestId,
        entityVersion: Number(updated.version),
        metadata: {
          mandateId: collection.mandate_id,
          merchantOrderId: paymentAttempt.merchant_order_id,
          providerState: fact.state,
          reason: body.reason,
        },
      })
      return {
        status: 200,
        body: {
          collectionId: updated.id,
          mandateId: updated.mandate_id,
          state: updated.notify_state,
          paymentState: paymentStateFromAttempt(paymentAttemptAfter),
          providerState: fact.state,
        },
      }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const cancelMandate = async (deps: AdminMandateDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["finance.operate"])
  const mandateId = parseOrThrow(uuidParam, (request.params as { mandateId?: unknown }).mandateId)
  const body = parseOrThrow(reasonBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${MANDATES_ROUTE}/:mandateId/cancel`, key),
    requestHash: hashRequest({ mandateId, reason: body.reason }),
    execute: async (tx) => {
      const locked = await deps.adminMandateRepository.findMandateForCancel(tx, mandateId)
      if (locked === null) throw new AppError("STATE_CONFLICT")
      const { mandate, sip } = locked
      const previousState = mandate.state
      let transitionedMandate = mandate

      if (mandate.state === "setup_pending") {
        const abandoned = await deps.mandatesRepository.requestSetupAbandonment(tx, {
          mandateId: mandate.id,
          expectedVersion: mandate.version,
          now: deps.clock(),
        })
        if (abandoned === null) throw new AppError("STATE_CONFLICT")
        transitionedMandate = abandoned
      } else {
        const transitioned = await deps.mandatesRepository.applyProviderMandateState(tx, {
          merchantSubscriptionId: mandate.merchant_subscription_id,
          providerSubscriptionId: mandate.provider_subscription_id,
          expectedVersion: mandate.version,
          expectedSipVersion: sip.version,
          fromState: mandate.state,
          toState: "cancel_pending",
          now: deps.clock(),
        })
        if (transitioned === null) throw new AppError("STATE_CONFLICT")
        transitionedMandate = transitioned.mandate
      }

      const command = await deps.adminMandateRepository.createCancelCommand(tx, {
        mandateId: mandate.id,
        sipPlanId: sip.id,
        userId: mandate.user_id,
        merchantSubscriptionId: mandate.merchant_subscription_id,
        previousMandateState: previousState as "setup_pending" | "active" | "paused",
      })

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "mandate.cancel",
        entityType: "payment_mandate",
        entityId: mandateId,
        fromState: previousState,
        toState: transitionedMandate.state,
        requestId: request.requestId,
        entityVersion: Number(transitionedMandate.version),
        metadata: {
          commandId: command.id,
          merchantSubscriptionId: mandate.merchant_subscription_id,
          reason: body.reason,
        },
      })

      return { status: 200, body: { commandId: command.id, state: command.state } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

export const registerAdminMandateRoutes = (
  application: FastifyInstance,
  deps: AdminMandateDeps,
): void => {
  application.get(MANDATES_ROUTE, (request, reply) => listMandates(deps, request, reply))
  application.get(`${MANDATES_ROUTE}/:mandateId`, (request, reply) => getMandateDetail(deps, request, reply))
  application.post(`${MANDATES_ROUTE}/:mandateId/reconcile`, (request, reply) => reconcileMandate(deps, request, reply))
  application.post(`${MANDATES_ROUTE}/:mandateId/cancel`, (request, reply) => cancelMandate(deps, request, reply))
  application.post(`${COLLECTIONS_ROUTE}/:collectionId/reconcile`, (request, reply) => reconcileCollection(deps, request, reply))
}
