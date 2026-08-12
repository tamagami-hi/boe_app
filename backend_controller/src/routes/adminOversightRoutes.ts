/**
 * Admin oversight routes (spec 04 §3.2, §5.2; spec 03 §4.1/§4.3/§4.4).
 * Web-cookie transport, RBAC per group, CSRF on unsafe methods, keyset cursors.
 *
 *   GET   /v1/admin/users                     directory (state/search filters)      users.read
 *   GET   /v1/admin/users/:id/detail          one user + roles/KYC/finance history  users.read
 *   GET   /v1/admin/users/:id/login-events    per-user sign-in attempts            users.read
 *   POST  /v1/admin/users/:id/suspend         lifecycle: active -> suspended        users.suspend
 *   POST  /v1/admin/users/:id/reinstate       lifecycle: suspended -> active        users.suspend
 *   POST  /v1/admin/users/:id/close           lifecycle: -> closed (terminal)       users.close
 *   POST  /v1/admin/users/:id/gain-allocations allocate a gain/loss to one investor finance.operate
 *   GET   /v1/admin/transactions              orders + booked execution/NAV         finance.read
 *   GET   /v1/admin/payments                  payment evidence                      finance.read
 *   GET   /v1/admin/mandates                  debit mandates                        finance.read
 *   GET   /v1/admin/sips                      SIP plans                             finance.read
 *   GET   /v1/admin/redemption-requests       redemption queue                      finance.read
 *   PATCH /v1/admin/redemption-requests/:id   approve/reject                        finance.operate
 *   GET   /v1/admin/audit-logs                redacted audit log                    audit.read
 *
 * Deliberate omissions, matching canonical decisions rather than the legacy
 * console: there is no payment approve/reject (confirmation is provider-webhook
 * driven), no capital inflow/outflow or reconciliation ledger (spec §8 removed the
 * synthetic ledger), and no SIP "control request" queue (SIP state changes are
 * commands on the plan). Above-threshold redemptions carry
 * `requiresDualApproval`; approving one needs the maker-checker engine
 * (`approval_actions`), so it is refused here instead of bypassing the control.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database, KycCaseState, UserAccountState } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { allocateGain } from "../domain/client/allocateGain.js"
import { returnPercent } from "../domain/client/portfolioLedger.js"
import { settleRedemption } from "../domain/client/settleRedemption.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AdminOversightRepository } from "../repositories/adminOversightRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { LoginEventRepository, LoginEventRow } from "../repositories/loginEventRepository.js"
import type { InvestorLedgerRepository } from "../repositories/investorLedgerRepository.js"
import type { RedemptionWriteRepository } from "../repositories/redemptionRepository.js"
import type { NotificationWriteRepository } from "../repositories/notificationRepository.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  iso,
  isoOrNull,
  limitSchema,
  optionalIdempotencyKey,
  paginate,
  readKeyset,
  reasonCodeSchema,
  reasonDetailSchema,
  runAdminMutation,
  searchSchema,
  uuidParam,
} from "./adminRouteKit.js"

export interface AdminOversightConfig {
  readonly cursorKey: Buffer
  readonly idempotencyTtlMs: number
}

export interface AdminOversightDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: AdminOversightConfig
  readonly oversightRepository: AdminOversightRepository
  readonly loginEventRepository: LoginEventRepository
  readonly investorLedgerRepository: InvestorLedgerRepository
  readonly redemptionRepository: RedemptionWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

const USERS_ROUTE = "/v1/admin/users"
const TRANSACTIONS_ROUTE = "/v1/admin/transactions"
const PAYMENTS_ROUTE = "/v1/admin/payments"
const MANDATES_ROUTE = "/v1/admin/mandates"
const SIPS_ROUTE = "/v1/admin/sips"
const REDEMPTIONS_ROUTE = "/v1/admin/redemption-requests"
const AUDIT_ROUTE = "/v1/admin/audit-logs"
const LOGIN_EVENTS_ROUTE = "/v1/admin/users/:userId/login-events"

// --- schemas ---

const pageQuery = { after: z.string().min(1).optional(), limit: limitSchema }

const usersQuerySchema = z
  .object({
    ...pageQuery,
    status: z.enum(["invited", "active", "suspended", "closed"]).optional(),
    q: searchSchema.optional(),
  })
  .strict()

const transactionsQuerySchema = z
  .object({
    ...pageQuery,
    fundId: z.string().uuid().optional(),
    status: z
      .enum([
        "submitted",
        "payment_pending",
        "payment_confirmed",
        "booked",
        "payment_failed",
        "cancelled",
        "rejected",
        "refunded",
        "reversed",
      ])
      .optional(),
    type: z.enum(["purchase", "sip_installment", "redemption", "refund", "adjustment"]).optional(),
    q: searchSchema.optional(),
  })
  .strict()

const paymentsQuerySchema = z
  .object({
    ...pageQuery,
    status: z.enum(["created", "provider_pending", "succeeded", "failed", "expired", "refunded"]).optional(),
    userId: z.string().uuid().optional(),
  })
  .strict()

const mandatesQuerySchema = z
  .object({
    ...pageQuery,
    status: z
      .enum(["created", "pending_user_authorization", "active", "paused", "revoked", "failed", "expired"])
      .optional(),
  })
  .strict()

const sipsQuerySchema = z
  .object({
    ...pageQuery,
    status: z.enum(["draft", "pending_mandate", "active", "paused", "cancelled", "completed"]).optional(),
  })
  .strict()

const redemptionsQuerySchema = z
  .object({
    ...pageQuery,
    status: z
      .enum([
        "submitted",
        "units_reserved",
        "approved",
        "settlement_pending",
        "settled",
        "rejected",
        "cancelled",
      ])
      .optional(),
  })
  .strict()

const auditQuerySchema = z
  .object({
    ...pageQuery,
    entityType: z.string().trim().max(80).optional(),
    command: z.string().trim().max(120).optional(),
    actorUserId: z.string().uuid().optional(),
    occurredFrom: z.string().datetime({ offset: true }).optional(),
    occurredTo: z.string().datetime({ offset: true }).optional(),
  })
  .strict()

const loginEventsQuerySchema = z.object({ ...pageQuery }).strict()

const decisionSchema = z
  .object({
    action: z.enum(["approve", "approved", "reject", "rejected"]),
    reason: reasonDetailSchema.optional(),
    reasonCode: reasonCodeSchema.optional(),
  })
  .strict()

const gainAllocationSchema = z
  .object({
    fundId: z.string().uuid(),
    /** Signed paise: negative allocates a loss. */
    gainPaise: z.coerce.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    effectiveDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "must be an ISO calendar date (YYYY-MM-DD)"),
    reasonCode: reasonCodeSchema,
    note: reasonDetailSchema.optional(),
  })
  .strict()

const lifecycleBodySchema = z
  .object({ reasonCode: reasonCodeSchema.optional(), reason: reasonDetailSchema.optional() })
  .strict()
  .optional()

const isApproval = (action: string): boolean => action === "approve" || action === "approved"

// --- generic list plumbing ---

interface Listed {
  readonly id: string
  readonly createdAt: Date | string
}

const listWith = async <Row extends Listed>(
  deps: AdminOversightDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  permissions: readonly string[],
  filters: Readonly<Record<string, unknown>>,
  load: (limit: number, keyset: ReturnType<typeof readKeyset>) => Promise<readonly Row[]>,
  map: (row: Row) => Record<string, unknown>,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, permissions)
  const now = deps.clock()
  const filterHash = computeFilterHash(filters)
  const after = (request.query as { after?: string } | undefined)?.after
  const keyset = readKeyset(deps.config.cursorKey, after, route, filterHash, now)
  const limit = Number((request.query as { limit?: unknown } | undefined)?.limit ?? 25)
  const rows = await load(limit + 1, keyset)
  const { items, page } = paginate(deps.config.cursorKey, rows, limit, route, filterHash, now, (row) => [
    iso(row.createdAt),
    row.id,
  ])
  return reply.sendData({ items: items.map(map) }, { status: 200, page })
}

/** Shared mutation wrapper: optional idempotency key, single transaction. */
const mutate = async <TBody extends Record<string, unknown>>(
  deps: AdminOversightDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  routeTemplate: string,
  method: "POST" | "PATCH" | "DELETE",
  canonical: Readonly<Record<string, unknown>>,
  principalUserId: string,
  execute: (tx: Parameters<Parameters<UnitOfWork["execute"]>[0]>[0]) => Promise<{ status: number; body: TBody }>,
) => {
  const key = optionalIdempotencyKey(request)
  if (key === null) {
    const outcome = await deps.unitOfWork.execute((tx) => execute(tx))
    return reply.sendData(outcome.body, { status: outcome.status })
  }
  const result = await runAdminMutation<TBody>({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principalUserId, routeTemplate, key, method),
    requestHash: hashRequest(canonical),
    execute,
  })
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

// --- mappers ---

const mapUser = (row: {
  readonly id: string
  readonly fullName: string
  readonly email: string
  readonly phone: string
  readonly accountState: UserAccountState
  readonly isPiiTombstoned: boolean
  readonly activatedAt: Date | null
  readonly suspendedAt: Date | null
  readonly closedAt: Date | null
  readonly kycState: string | null
  readonly holdingsCount: number
  readonly ordersCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}): Record<string, unknown> => ({
  id: row.id,
  name: row.fullName,
  fullName: row.fullName,
  email: row.email,
  phone: row.phone,
  status: row.accountState,
  accountState: row.accountState,
  isPiiTombstoned: row.isPiiTombstoned,
  kycStatus: row.kycState,
  holdingsCount: row.holdingsCount,
  ordersCount: row.ordersCount,
  activatedAt: isoOrNull(row.activatedAt),
  suspendedAt: isoOrNull(row.suspendedAt),
  closedAt: isoOrNull(row.closedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

const mapOrder = (row: {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly fundId: string
  readonly fundSlug: string
  readonly fundName: string | null
  readonly sipPlanId: string | null
  readonly type: string
  readonly state: string
  readonly amountPaise: string | null
  readonly currency: string
  readonly requestedAt: Date | null
  readonly bookedAt: Date | null
  readonly failureCode: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}): Record<string, unknown> => ({
  id: row.id,
  userId: row.userId,
  userEmail: row.userEmail,
  fundId: row.fundId,
  fundSlug: row.fundSlug,
  fundName: row.fundName,
  sipPlanId: row.sipPlanId,
  type: row.type,
  status: row.state,
  amountPaise: row.amountPaise,
  currency: row.currency,
  requestedAt: isoOrNull(row.requestedAt),
  bookedAt: isoOrNull(row.bookedAt),
  failureCode: row.failureCode,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

const mapPayment = (row: {
  readonly id: string
  readonly orderId: string
  readonly userId: string
  readonly userEmail: string
  readonly amountPaise: string
  readonly currency: string
  readonly state: string
  readonly attemptCount: number
  readonly provider: string | null
  readonly providerReference: string | null
  readonly succeededAt: Date | null
  readonly failedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}): Record<string, unknown> => ({
  id: row.id,
  orderId: row.orderId,
  userId: row.userId,
  userEmail: row.userEmail,
  amountPaise: row.amountPaise,
  currency: row.currency,
  status: row.state,
  attemptCount: row.attemptCount,
  provider: row.provider,
  providerReference: row.providerReference,
  succeededAt: isoOrNull(row.succeededAt),
  failedAt: isoOrNull(row.failedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

const mapMandate = (row: {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly provider: string
  readonly providerMandateId: string | null
  readonly maxAmountPaise: string
  readonly frequency: string
  readonly debitDay: number | null
  readonly state: string
  readonly validFrom: Date | null
  readonly validTo: Date | null
  readonly sipCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
}): Record<string, unknown> => ({
  id: row.id,
  userId: row.userId,
  userEmail: row.userEmail,
  provider: row.provider,
  providerMandateId: row.providerMandateId,
  maxAmountPaise: row.maxAmountPaise,
  frequency: row.frequency,
  debitDay: row.debitDay,
  status: row.state,
  validFrom: isoOrNull(row.validFrom),
  validTo: isoOrNull(row.validTo),
  sipCount: row.sipCount,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

const mapSip = (row: {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly fundId: string
  readonly fundSlug: string
  readonly amountPaise: string
  readonly debitDay: number
  readonly state: string
  readonly mandateId: string | null
  readonly startDate: string | null
  readonly nextDueDate: string | null
  readonly installments: number
  readonly createdAt: Date
  readonly updatedAt: Date
}): Record<string, unknown> => ({
  id: row.id,
  userId: row.userId,
  userEmail: row.userEmail,
  fundId: row.fundId,
  fundSlug: row.fundSlug,
  amountPaise: row.amountPaise,
  debitDay: row.debitDay,
  status: row.state,
  mandateId: row.mandateId,
  startDate: row.startDate,
  nextDueDate: row.nextDueDate,
  installments: row.installments,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

const mapRedemption = (row: {
  readonly id: string
  readonly orderId: string
  readonly userId: string
  readonly userEmail: string
  readonly fundId: string
  readonly fundSlug: string
  readonly state: string
  readonly mode: string | null
  readonly requestedAmountPaise: string | null
  readonly principalComponentPaise: string | null
  readonly returnsComponentPaise: string | null
  readonly settledAmountPaise: string | null
  readonly requiresDualApproval: boolean
  readonly financePolicyVersion: number
  readonly submittedAt: Date | null
  readonly approvedAt: Date | null
  readonly settledAt: Date | null
  readonly reasonCode: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}): Record<string, unknown> => ({
  id: row.id,
  orderId: row.orderId,
  userId: row.userId,
  userEmail: row.userEmail,
  fundId: row.fundId,
  fundSlug: row.fundSlug,
  status: row.state,
  mode: row.mode,
  requestedAmountPaise: row.requestedAmountPaise,
  principalComponentPaise: row.principalComponentPaise,
  returnsComponentPaise: row.returnsComponentPaise,
  settledAmountPaise: row.settledAmountPaise,
  requiresDualApproval: row.requiresDualApproval,
  financePolicyVersion: row.financePolicyVersion,
  submittedAt: isoOrNull(row.submittedAt),
  approvedAt: isoOrNull(row.approvedAt),
  settledAt: isoOrNull(row.settledAt),
  reasonCode: row.reasonCode,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

const mapKycCase = (row: {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly userFullName: string
  readonly state: KycCaseState
  readonly provider: string | null
  readonly submittedAt: Date | null
  readonly decidedAt: Date | null
  readonly expiresAt: Date | null
  readonly reviewCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}): Record<string, unknown> => ({
  id: row.id,
  userId: row.userId,
  userEmail: row.userEmail,
  name: row.userFullName,
  kycReviewStatus: row.state,
  status: row.state,
  provider: row.provider,
  submittedAt: isoOrNull(row.submittedAt),
  kycReviewedAt: isoOrNull(row.decidedAt),
  decidedAt: isoOrNull(row.decidedAt),
  expiresAt: isoOrNull(row.expiresAt),
  reviewCount: row.reviewCount,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

const mapAuditEvent = (row: {
  readonly id: string
  readonly occurredAt: Date
  readonly actorType: string
  readonly actorUserId: string | null
  readonly actorEmail: string | null
  readonly command: string
  readonly entityType: string
  readonly entityId: string
  readonly fromState: string | null
  readonly toState: string | null
  readonly reasonCode: string | null
  readonly requestId: string
  readonly entityVersion: string
  readonly metadata: unknown
  readonly createdAt: Date
}): Record<string, unknown> => ({
  id: row.id,
  occurredAt: iso(row.occurredAt),
  createdAt: iso(row.occurredAt),
  actorType: row.actorType,
  actorUserId: row.actorUserId,
  actorEmail: row.actorEmail,
  action: row.command,
  command: row.command,
  entityType: row.entityType,
  entityId: row.entityId,
  fromState: row.fromState,
  toState: row.toState,
  reasonCode: row.reasonCode,
  requestId: row.requestId,
  entityVersion: Number(row.entityVersion),
  metadata: row.metadata,
})

// --- users ---

/**
 * One pool the user holds, derived from their ledger (Option B). Money stays a
 * string; the percentage is computed once here for display.
 */
const mapPosition = (row: {
  readonly fundId: string
  readonly fundSlug: string
  readonly fundName: string | null
  readonly totalInvestmentPaise: string
  readonly currentValuePaise: string
  readonly sipInstallmentCount: number
  readonly sipTotalPaise: string
  readonly lumpSumCount: number
  readonly lumpSumTotalPaise: string
  readonly redemptionCount: number
  readonly redeemedTotalPaise: string
  readonly allocatedGainPaise: string
  readonly firstInvestmentDate: string | null
  readonly lastActivityDate: string | null
}): Record<string, unknown> => {
  const totalInvestment = BigInt(row.totalInvestmentPaise)
  const currentValue = BigInt(row.currentValuePaise)
  const totalReturn = currentValue - totalInvestment
  return {
    fundId: row.fundId,
    fundSlug: row.fundSlug,
    fundName: row.fundName,
    totalInvestmentPaise: row.totalInvestmentPaise,
    currentValuePaise: row.currentValuePaise,
    totalReturnPaise: totalReturn.toString(),
    returnPercent: returnPercent(totalReturn, totalInvestment),
    sipInstallmentCount: row.sipInstallmentCount,
    sipTotalPaise: row.sipTotalPaise,
    lumpSumCount: row.lumpSumCount,
    lumpSumTotalPaise: row.lumpSumTotalPaise,
    redemptionCount: row.redemptionCount,
    redeemedTotalPaise: row.redeemedTotalPaise,
    allocatedGainPaise: row.allocatedGainPaise,
    firstInvestmentDate: row.firstInvestmentDate,
    lastActivityDate: row.lastActivityDate,
  }
}

/** Sum a paise column that arrives as strings, keeping integer arithmetic. */
const sumPaise = (values: readonly string[]): string =>
  values.reduce((total, value) => total + BigInt(value), 0n).toString()

const listUsers = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const query = parseOrThrow(usersQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    USERS_ROUTE,
    ["users.read", "users.read_limited"],
    { status: query.status ?? null, q: query.q ?? null },
    async (limit, keyset) =>
      deps.oversightRepository.listUsers(deps.database, {
        ...keyset,
        limit,
        ...(query.status === undefined ? {} : { state: query.status }),
        ...(query.q === undefined ? {} : { search: query.q }),
      }),
    mapUser,
  )
}

const getUserDetail = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["users.read"])
  const userId = parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)
  const detail = await deps.oversightRepository.userDetail(deps.database, userId)
  if (detail === null) throw new AppError("RESOURCE_NOT_FOUND")

  const positions = detail.positions.map(mapPosition)
  const totalInvestment = BigInt(sumPaise(detail.positions.map((row) => row.totalInvestmentPaise)))
  const currentValue = BigInt(sumPaise(detail.positions.map((row) => row.currentValuePaise)))
  const totalReturn = currentValue - totalInvestment

  return reply.sendData(
    {
      user: mapUser(detail.user),
      roles: detail.roles,
      kyc: detail.kyc === null ? null : mapKycCase(detail.kyc),
      orders: detail.orders.map(mapOrder),
      payments: detail.payments.map(mapPayment),
      mandates: detail.mandates.map(mapMandate),
      sips: detail.sips.map(mapSip),
      positions,
      // The investor's dashboard as the admin sees it, derived from the ledger:
      // this is exactly what the client is shown, not a second valuation basis.
      portfolio: {
        poolCount: positions.length,
        totalInvestmentPaise: totalInvestment.toString(),
        currentValuePaise: currentValue.toString(),
        totalReturnPaise: totalReturn.toString(),
        returnPercent: returnPercent(totalReturn, totalInvestment),
        sipInstallmentCount: detail.positions.reduce((n, row) => n + row.sipInstallmentCount, 0),
        sipTotalPaise: sumPaise(detail.positions.map((row) => row.sipTotalPaise)),
        lumpSumCount: detail.positions.reduce((n, row) => n + row.lumpSumCount, 0),
        lumpSumTotalPaise: sumPaise(detail.positions.map((row) => row.lumpSumTotalPaise)),
        redeemedTotalPaise: sumPaise(detail.positions.map((row) => row.redeemedTotalPaise)),
        allocatedGainPaise: sumPaise(detail.positions.map((row) => row.allocatedGainPaise)),
      },
    },
    { status: 200 },
  )
}

/**
 * Allocate a gain (or loss) to one investor in one pool — Option B's growth path.
 * This is the only way an investor's value moves other than their own money in or
 * out, so it requires `finance.operate` and records the allocator, date and reason.
 */
const postGainAllocation = async (
  deps: AdminOversightDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["finance.operate"])
  const userId = parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)
  const body = parseOrThrow(gainAllocationSchema, request.body)

  return mutate(
    deps,
    request,
    reply,
    `${USERS_ROUTE}/:userId/gain-allocations`,
    "POST",
    { userId, fundId: body.fundId, gainPaise: body.gainPaise, effectiveDate: body.effectiveDate },
    principal.userId,
    async (tx) => {
      const result = await allocateGain(
        tx,
        {
          investorLedgerRepository: deps.investorLedgerRepository,
          notificationRepository: deps.notificationRepository,
          auditRepository: deps.auditRepository,
          clock: deps.clock,
        },
        {
          userId,
          fundId: body.fundId,
          gainPaise: BigInt(body.gainPaise),
          effectiveDate: body.effectiveDate,
          allocatedByUserId: principal.userId,
          reasonCode: body.reasonCode,
          note: body.note ?? null,
          requestId: request.requestId,
        },
      )
      return {
        status: 201,
        body: {
          ledgerEntryId: result.entry.id,
          userId,
          fundId: body.fundId,
          effectiveDate: result.entry.effectiveDate,
          totalInvestmentPaise: result.totalInvestmentPaise.toString(),
          currentValuePaise: result.currentValuePaise.toString(),
          totalReturnPaise: result.totalReturnPaise.toString(),
          returnPercent: result.returnPercent,
        },
      }
    },
  )
}

const changeUserState = async (
  deps: AdminOversightDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  nextState: UserAccountState,
  permissions: readonly string[],
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, permissions)
  const userId = parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)
  const body = parseOrThrow(lifecycleBodySchema, request.body ?? undefined)
  const now = deps.clock()

  return mutate(
    deps,
    request,
    reply,
    `${USERS_ROUTE}/:userId/${nextState}`,
    "POST",
    { userId, nextState },
    principal.userId,
    async (tx) => {
      const user = await deps.oversightRepository.lockUser(tx, userId)
      if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
      // Closed is terminal; suspending an invited account or reinstating an
      // active one are both no-op transitions the console should not request.
      const allowed =
        (nextState === "suspended" && user.account_state === "active") ||
        (nextState === "active" && user.account_state === "suspended") ||
        (nextState === "closed" && user.account_state !== "closed")
      if (!allowed) throw new AppError("STATE_CONFLICT")

      const updated = await deps.oversightRepository.setUserAccountState(tx, {
        userId,
        state: nextState,
        now,
        expectedVersion: Number(user.version),
      })
      if (updated === null) throw new AppError("STATE_CONFLICT")

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: `user.${nextState}`,
        entityType: "user",
        entityId: userId,
        fromState: user.account_state,
        toState: updated.account_state,
        requestId: request.requestId,
        entityVersion: Number(updated.version),
        metadata: {
          ...(body?.reasonCode === undefined ? {} : { reasonCode: body.reasonCode }),
          ...(body?.reason === undefined ? {} : { reason: body.reason }),
        },
      })
      return {
        status: 200,
        body: { userId, status: updated.account_state, version: Number(updated.version) },
      }
    },
  )
}

// --- finance reads ---

const listTransactions = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const query = parseOrThrow(transactionsQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    TRANSACTIONS_ROUTE,
    ["finance.read"],
    {
      fundId: query.fundId ?? null,
      status: query.status ?? null,
      type: query.type ?? null,
      q: query.q ?? null,
    },
    async (limit, keyset) =>
      deps.oversightRepository.listOrders(deps.database, {
        ...keyset,
        limit,
        ...(query.fundId === undefined ? {} : { fundId: query.fundId }),
        ...(query.status === undefined ? {} : { state: query.status }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.q === undefined ? {} : { search: query.q }),
      }),
    mapOrder,
  )
}

const listPayments = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const query = parseOrThrow(paymentsQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    PAYMENTS_ROUTE,
    ["finance.read"],
    { status: query.status ?? null, userId: query.userId ?? null },
    async (limit, keyset) =>
      deps.oversightRepository.listPayments(deps.database, {
        ...keyset,
        limit,
        ...(query.status === undefined ? {} : { state: query.status }),
        ...(query.userId === undefined ? {} : { userId: query.userId }),
      }),
    mapPayment,
  )
}

const listMandates = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const query = parseOrThrow(mandatesQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    MANDATES_ROUTE,
    ["finance.read"],
    { status: query.status ?? null },
    async (limit, keyset) =>
      deps.oversightRepository.listMandates(deps.database, {
        ...keyset,
        limit,
        ...(query.status === undefined ? {} : { state: query.status }),
      }),
    mapMandate,
  )
}

const listSips = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const query = parseOrThrow(sipsQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    SIPS_ROUTE,
    ["finance.read"],
    { status: query.status ?? null },
    async (limit, keyset) =>
      deps.oversightRepository.listSips(deps.database, {
        ...keyset,
        limit,
        ...(query.status === undefined ? {} : { state: query.status }),
      }),
    mapSip,
  )
}

const listRedemptions = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const query = parseOrThrow(redemptionsQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    REDEMPTIONS_ROUTE,
    ["finance.read"],
    { status: query.status ?? null },
    async (limit, keyset) =>
      deps.oversightRepository.listRedemptions(deps.database, {
        ...keyset,
        limit,
        ...(query.status === undefined ? {} : { state: query.status }),
      }),
    mapRedemption,
  )
}

/**
 * Body of a redemption decision. The settlement figures are present when the
 * request was approved (and therefore paid out) and null when it was rejected.
 */
interface RedemptionDecisionBody extends Record<string, unknown> {
  readonly id: string
  readonly status: string
  readonly version: number
  readonly settledAmountPaise: string | null
  readonly principalComponentPaise: string | null
  readonly returnsComponentPaise: string | null
  readonly currentValuePaise: string | null
}

const decideRedemption = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["finance.operate"])
  const requestId = parseOrThrow(uuidParam, (request.params as { requestId?: unknown }).requestId)
  const body = parseOrThrow(decisionSchema, request.body)
  const approve = isApproval(body.action)
  const now = deps.clock()

  return mutate<RedemptionDecisionBody>(
    deps,
    request,
    reply,
    `${REDEMPTIONS_ROUTE}/:requestId`,
    "PATCH",
    { requestId, approve },
    principal.userId,
    async (tx) => {
      const ledgerDeps = {
        redemptionRepository: deps.redemptionRepository,
        investorLedgerRepository: deps.investorLedgerRepository,
        notificationRepository: deps.notificationRepository,
        auditRepository: deps.auditRepository,
        clock: deps.clock,
      }

      // Approving a redemption settles it: the payout is appended to the
      // investor's ledger in this same transaction, so their value falls now
      // rather than at some later reconciliation.
      if (approve) {
        const settled = await settleRedemption(tx, ledgerDeps, {
          redemptionRequestId: requestId,
          settledByUserId: principal.userId,
          reasonCode: body.reasonCode ?? "admin_approved",
          requestId: request.requestId,
        })
        return {
          status: 200,
          body: {
            id: requestId,
            status: settled.request.state,
            version: Number(settled.request.version),
            settledAmountPaise: settled.settledAmountPaise.toString(),
            principalComponentPaise: settled.principalComponentPaise.toString(),
            returnsComponentPaise: settled.returnsComponentPaise.toString(),
            currentValuePaise: settled.currentValuePaise.toString(),
          },
        }
      }

      const existing = await deps.redemptionRepository.lockById(tx, requestId)
      if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (existing.state !== "submitted" && existing.state !== "units_reserved") {
        throw new AppError("STATE_CONFLICT")
      }
      const updated = await deps.redemptionRepository.markRejected(tx, {
        id: requestId,
        reasonCode: body.reasonCode ?? "admin_rejected",
        now,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "redemption.rejected",
        entityType: "redemption_request",
        entityId: requestId,
        fromState: existing.state,
        toState: updated.state,
        requestId: request.requestId,
        entityVersion: Number(updated.version),
        metadata: { ...(body.reason === undefined ? {} : { reason: body.reason }) },
      })
      return {
        status: 200,
        body: {
          id: requestId,
          status: updated.state,
          version: Number(updated.version),
          settledAmountPaise: null,
          principalComponentPaise: null,
          returnsComponentPaise: null,
          currentValuePaise: null,
        },
      }
    },
  )
}

// --- audit ---

const listAuditEvents = async (deps: AdminOversightDeps, request: FastifyRequest, reply: FastifyReply) => {
  const query = parseOrThrow(auditQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    AUDIT_ROUTE,
    ["audit.read"],
    {
      entityType: query.entityType ?? null,
      command: query.command ?? null,
      actorUserId: query.actorUserId ?? null,
      occurredFrom: query.occurredFrom ?? null,
      occurredTo: query.occurredTo ?? null,
    },
    async (limit, keyset) =>
      deps.oversightRepository.listAuditEvents(deps.database, {
        ...keyset,
        limit,
        ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
        ...(query.command === undefined ? {} : { command: query.command }),
        ...(query.actorUserId === undefined ? {} : { actorUserId: query.actorUserId }),
        ...(query.occurredFrom === undefined ? {} : { occurredFrom: new Date(query.occurredFrom) }),
        ...(query.occurredTo === undefined ? {} : { occurredTo: new Date(query.occurredTo) }),
      }),
    (row) => mapAuditEvent(row),
  )
}

// --- login history ---

/**
 * Per-user sign-in attempts, newest first.
 *
 * Distinct from `/v1/admin/audit-logs`: the audit log records successful logins
 * only (they are state transitions with a session to point at), whereas this
 * shows failures too, with the address and User-Agent the attempt came from.
 * `users.read` rather than `audit.read` — it is part of looking at one user.
 */
const mapLoginEvent = (row: LoginEventRow): Record<string, unknown> => ({
  id: row.id,
  occurredAt: iso(row.occurredAt),
  createdAt: iso(row.createdAt),
  userId: row.userId,
  email: row.email,
  channel: row.channel,
  outcome: row.outcome,
  succeeded: row.outcome === "success",
  sessionId: row.sessionId,
  ipAddress: row.ipAddress,
  userAgent: row.userAgent,
  requestId: row.requestId,
})

const listUserLoginEvents = async (
  deps: AdminOversightDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const userId = parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)
  parseOrThrow(loginEventsQuerySchema, request.query)
  return listWith(
    deps,
    request,
    reply,
    LOGIN_EVENTS_ROUTE,
    ["users.read"],
    // The user is part of the filter identity, so a cursor issued for one user is
    // not accepted for another.
    { userId },
    async (limit, keyset) =>
      deps.loginEventRepository.listForUser(deps.database, { ...keyset, limit, userId }),
    mapLoginEvent,
  )
}

export const registerAdminOversightRoutes = (
  application: FastifyInstance,
  deps: AdminOversightDeps,
): void => {
  application.get(USERS_ROUTE, async (request, reply) => listUsers(deps, request, reply))
  application.get(`${USERS_ROUTE}/:userId/detail`, async (request, reply) =>
    getUserDetail(deps, request, reply),
  )
  application.get(`${USERS_ROUTE}/:userId/login-events`, async (request, reply) =>
    listUserLoginEvents(deps, request, reply),
  )
  application.post(`${USERS_ROUTE}/:userId/suspend`, async (request, reply) =>
    changeUserState(deps, request, reply, "suspended", ["users.suspend"]),
  )
  application.post(`${USERS_ROUTE}/:userId/reinstate`, async (request, reply) =>
    changeUserState(deps, request, reply, "active", ["users.suspend"]),
  )
  application.post(`${USERS_ROUTE}/:userId/gain-allocations`, async (request, reply) =>
    postGainAllocation(deps, request, reply),
  )
  application.post(`${USERS_ROUTE}/:userId/close`, async (request, reply) =>
    changeUserState(deps, request, reply, "closed", ["users.close"]),
  )

  application.get(TRANSACTIONS_ROUTE, async (request, reply) => listTransactions(deps, request, reply))
  application.get(PAYMENTS_ROUTE, async (request, reply) => listPayments(deps, request, reply))
  application.get(MANDATES_ROUTE, async (request, reply) => listMandates(deps, request, reply))
  application.get(SIPS_ROUTE, async (request, reply) => listSips(deps, request, reply))

  application.get(REDEMPTIONS_ROUTE, async (request, reply) => listRedemptions(deps, request, reply))
  application.patch(`${REDEMPTIONS_ROUTE}/:requestId`, async (request, reply) =>
    decideRedemption(deps, request, reply),
  )

  application.get(AUDIT_ROUTE, async (request, reply) => listAuditEvents(deps, request, reply))
}
