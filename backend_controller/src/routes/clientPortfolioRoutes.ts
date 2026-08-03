/**
 * Client portfolio routes — Option B (model document sections A, B, E).
 * Native bearer transport; every handler re-resolves the principal, so a
 * suspended or closed account cannot read or redeem.
 *
 *   GET  /v1/client/portfolio      "My Investment" + "Investment Summary"
 *   GET  /v1/client/transactions   the dated ledger behind those figures
 *   GET  /v1/client/redemptions    the investor's redemption requests
 *   POST /v1/client/redemptions    submit one (full / returns only / half / custom)
 *
 * Every figure is derived from the investor's ledger on each read — Total
 * Investment, Current Value, Total Return, Return %, SIP count and total,
 * lump-sum count and total. Nothing is cached and no balance is stored, so the
 * dashboard cannot drift from the events that produced it.
 *
 * `/v1/client/holdings` is gone: there are no units to hold. A pool position is
 * money in and money currently attributed, which `/portfolio` reports per pool.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { Database } from "../db/types.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import {
  deriveInvestingEligibility,
  type EligibilityInputs,
} from "../domain/client/investingEligibility.js"
import { derivePortfolio } from "../domain/client/portfolioLedger.js"
import { toLedgerEntries } from "../domain/client/portfolioProjection.js"
import { requestRedemption } from "../domain/client/requestRedemption.js"
import { computeFilterHash, decodeCursor, encodeCursor } from "../http/cursor.js"
import type { PageMeta } from "../http/envelope.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type {
  ClientPortfolioReadRepository,
  OrderRow,
} from "../repositories/clientPortfolioRepository.js"
import type {
  InvestorLedgerRepository,
  LedgerEntryRow,
} from "../repositories/investorLedgerRepository.js"
import type {
  RedemptionRequestRow,
  RedemptionWriteRepository,
} from "../repositories/redemptionRepository.js"

export interface ClientPortfolioConfig {
  readonly cursorKey: Buffer
}

export interface ClientPortfolioDeps extends NativeRequestAuthDeps {
  readonly clientPortfolioRepository: ClientPortfolioReadRepository
  readonly investorLedgerRepository: InvestorLedgerRepository
  readonly redemptionRepository: RedemptionWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: ClientPortfolioConfig
}

const ORDERS_ROUTE = "/v1/client/orders"
const PORTFOLIO_ROUTE = "/v1/client/portfolio"
const TRANSACTIONS_ROUTE = "/v1/client/transactions"
const REDEMPTIONS_ROUTE = "/v1/client/redemptions"
const MAX_TRANSACTIONS = 200

const historyQuerySchema = z
  .object({ after: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) })
  .strict()

const transactionsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(MAX_TRANSACTIONS).default(50) })
  .strict()

const redemptionSchema = z
  .object({
    fundId: z.string().uuid(),
    mode: z.enum(["full", "returns_only", "half", "custom"]),
    /** Required for `custom`; rupees are never accepted, only paise. */
    amountPaise: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict()

const uuidParam = z.string().uuid()

const iso = (value: Date | string): string => new Date(value).toISOString()
const isoOrNull = (value: Date | string | null): string | null => (value === null ? null : iso(value))

const mapOrder = (row: OrderRow): Record<string, unknown> => ({
  orderId: row.id,
  fundId: row.fundId,
  sipPlanId: row.sipPlanId,
  type: row.type,
  status: row.state,
  amountPaise: row.amountPaise,
  currency: row.currency,
  requestedAt: isoOrNull(row.requestedAt),
  paymentConfirmedAt: isoOrNull(row.paymentConfirmedAt),
  bookedAt: isoOrNull(row.bookedAt),
  cancelledAt: isoOrNull(row.cancelledAt),
  failureCode: row.failureCode,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

/** One ledger row as the investor's transaction list shows it. */
const mapTransaction = (row: LedgerEntryRow): Record<string, unknown> => ({
  id: row.id,
  fundId: row.fundId,
  type: row.entryType,
  amountPaise: row.amountPaise,
  // Signed deltas explain how the row moved each headline figure.
  principalDeltaPaise: row.principalDeltaPaise,
  valueDeltaPaise: row.valueDeltaPaise,
  date: row.effectiveDate,
  orderId: row.orderId,
  note: row.note,
  createdAt: iso(row.createdAt),
})

const mapRedemption = (row: RedemptionRequestRow): Record<string, unknown> => ({
  id: row.id,
  fundId: row.fundId,
  fundSlug: row.fundSlug,
  status: row.state,
  mode: row.mode,
  requestedAmountPaise: row.requestedAmountPaise,
  principalComponentPaise: row.principalComponentPaise,
  returnsComponentPaise: row.returnsComponentPaise,
  settledAmountPaise: row.settledAmountPaise,
  reasonCode: row.reasonCode,
  submittedAt: isoOrNull(row.submittedAt),
  approvedAt: isoOrNull(row.approvedAt),
  settledAt: isoOrNull(row.settledAt),
  createdAt: iso(row.createdAt),
})

const getEligibility = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const now = deps.clock()
  const inputsRow = await deps.clientPortfolioRepository.eligibilityInputs(deps.database, principal.userId)
  if (inputsRow === null) throw new AppError("RESOURCE_NOT_FOUND")

  const inputs: EligibilityInputs = {
    accountState: inputsRow.accountState,
    kyc:
      inputsRow.kycState === null
        ? null
        : { state: inputsRow.kycState, expiresAt: isoOrNull(inputsRow.kycExpiresAt) },
    now,
  }
  const decision = deriveInvestingEligibility(inputs)
  return reply.sendData(
    {
      eligibility: decision.eligibility,
      reason: decision.reason,
      canInvest: decision.eligibility === "eligible",
      kycState: inputsRow.kycState,
      evaluatedAt: iso(now),
    },
    { status: 200 },
  )
}

/**
 * "My Investment" and "Investment Summary" in one read: the whole-portfolio
 * headline plus a per-pool breakdown, all folded from the ledger.
 */
const getPortfolio = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const rows = await deps.investorLedgerRepository.listByUser(deps.database, principal.userId)
  const entries = toLedgerEntries(rows)
  const summary = derivePortfolio(entries)

  const fundIds = [...new Set(entries.map((entry) => entry.fundId))]
  const pools = fundIds.map((fundId) => {
    const perFund = derivePortfolio(entries.filter((entry) => entry.fundId === fundId))
    return {
      fundId,
      totalInvestmentPaise: perFund.totalInvestmentPaise.toString(),
      currentValuePaise: perFund.currentValuePaise.toString(),
      totalReturnPaise: perFund.totalReturnPaise.toString(),
      returnPercent: perFund.returnPercent,
      sipInstallmentCount: perFund.sipInstallmentCount,
      sipTotalPaise: perFund.sipTotalPaise.toString(),
      lumpSumCount: perFund.lumpSumCount,
      lumpSumTotalPaise: perFund.lumpSumTotalPaise.toString(),
      redeemedTotalPaise: perFund.redeemedTotalPaise.toString(),
      allocatedGainPaise: perFund.allocatedGainPaise.toString(),
      firstInvestmentDate: perFund.firstInvestmentDate,
      lastActivityDate: perFund.lastActivityDate,
    }
  })

  return reply.sendData(
    {
      // Section A — My Investment.
      currentValuePaise: summary.currentValuePaise.toString(),
      totalInvestmentPaise: summary.totalInvestmentPaise.toString(),
      totalReturnPaise: summary.totalReturnPaise.toString(),
      returnPercent: summary.returnPercent,
      returnSince: summary.firstInvestmentDate,
      lastUpdated: summary.lastActivityDate,
      // Section B — Investment Summary.
      summary: {
        sipInstallmentCount: summary.sipInstallmentCount,
        sipTotalPaise: summary.sipTotalPaise.toString(),
        lumpSumCount: summary.lumpSumCount,
        lumpSumTotalPaise: summary.lumpSumTotalPaise.toString(),
        redemptionCount: summary.redemptionCount,
        redeemedTotalPaise: summary.redeemedTotalPaise.toString(),
        allocatedGainPaise: summary.allocatedGainPaise.toString(),
      },
      pools,
    },
    { status: 200 },
  )
}

const listTransactions = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const query = parseOrThrow(transactionsQuerySchema, request.query)
  const rows = await deps.investorLedgerRepository.listRecentByUser(
    deps.database,
    principal.userId,
    query.limit,
  )
  return reply.sendData({ items: rows.map(mapTransaction) }, { status: 200 })
}

const listOrders = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const query = parseOrThrow(historyQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId: principal.userId })

  let afterCreatedAt: Date | undefined
  let afterId: string | undefined
  if (query.after !== undefined) {
    const parts = decodeCursor(deps.config.cursorKey, query.after, {
      route: ORDERS_ROUTE,
      filterHash,
      now,
    })
    const createdAtRaw = parts[0]
    const idRaw = parts[1]
    if (createdAtRaw === undefined || idRaw === undefined) throw new AppError("CURSOR_INVALID")
    afterCreatedAt = new Date(createdAtRaw)
    afterId = idRaw
  }

  const rows = await deps.clientPortfolioRepository.listOrders(deps.database, {
    userId: principal.userId,
    ...(afterCreatedAt === undefined ? {} : { afterCreatedAt }),
    ...(afterId === undefined ? {} : { afterId }),
    limit: query.limit + 1,
  })
  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows
  const last = items[items.length - 1]
  const page: PageMeta = {
    nextCursor:
      hasMore && last !== undefined
        ? encodeCursor(deps.config.cursorKey, {
            route: ORDERS_ROUTE,
            filterHash,
            sortValues: [iso(last.createdAt), last.id],
            now,
          })
        : null,
    limit: query.limit,
    hasMore,
  }
  return reply.sendData({ items: items.map(mapOrder) }, { status: 200, page })
}

const getOrder = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const orderId = parseOrThrow(uuidParam, (request.params as { orderId?: unknown }).orderId)
  const order = await deps.clientPortfolioRepository.findOrder(deps.database, principal.userId, orderId)
  if (order === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData({ order: mapOrder(order) }, { status: 200 })
}

const getPayment = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const paymentId = parseOrThrow(uuidParam, (request.params as { paymentId?: unknown }).paymentId)
  const payment = await deps.clientPortfolioRepository.findPayment(
    deps.database,
    principal.userId,
    paymentId,
  )
  if (payment === null) throw new AppError("RESOURCE_NOT_FOUND")

  return reply.sendData(
    {
      payment: {
        paymentId: payment.id,
        orderId: payment.orderId,
        fundId: payment.fundId,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
        status: payment.state,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
        attemptStatus: payment.attemptState,
        failureCode: payment.failureCode,
        expiresAt: isoOrNull(payment.expiresAt),
        succeededAt: isoOrNull(payment.succeededAt),
        failedAt: isoOrNull(payment.failedAt),
        createdAt: iso(payment.createdAt),
        updatedAt: iso(payment.updatedAt),
      },
    },
    { status: 200 },
  )
}

const listRedemptions = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const rows = await deps.redemptionRepository.listByUser(deps.database, principal.userId, 50)
  return reply.sendData({ items: rows.map(mapRedemption) }, { status: 200 })
}

const postRedemption = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const body = parseOrThrow(redemptionSchema, request.body)
  if (body.mode === "custom" && body.amountPaise === undefined) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { amountPaise: ["a custom redemption needs an amount"] },
    })
  }

  const outcome = await deps.unitOfWork.execute((tx) =>
    requestRedemption(
      tx,
      {
        investorLedgerRepository: deps.investorLedgerRepository,
        redemptionRepository: deps.redemptionRepository,
        auditRepository: deps.auditRepository,
        clock: deps.clock,
      },
      {
        userId: principal.userId,
        fundId: body.fundId,
        mode: body.mode,
        ...(body.amountPaise === undefined ? {} : { customAmountPaise: BigInt(body.amountPaise) }),
        requestId: request.requestId,
      },
    ),
  )

  return reply.sendData(
    {
      redemption: mapRedemption(outcome.request),
      availableValuePaise: outcome.availableValuePaise.toString(),
    },
    { status: 201 },
  )
}

export const registerClientPortfolioRoutes = (
  application: FastifyInstance,
  deps: ClientPortfolioDeps,
): void => {
  application.get("/v1/client/eligibility", async (request, reply) => getEligibility(deps, request, reply))
  application.get(PORTFOLIO_ROUTE, async (request, reply) => getPortfolio(deps, request, reply))
  application.get(TRANSACTIONS_ROUTE, async (request, reply) => listTransactions(deps, request, reply))
  application.get(ORDERS_ROUTE, async (request, reply) => listOrders(deps, request, reply))
  application.get(`${ORDERS_ROUTE}/:orderId`, async (request, reply) => getOrder(deps, request, reply))
  application.get("/v1/client/payments/:paymentId", async (request, reply) =>
    getPayment(deps, request, reply),
  )
  application.get(REDEMPTIONS_ROUTE, async (request, reply) => listRedemptions(deps, request, reply))
  application.post(REDEMPTIONS_ROUTE, async (request, reply) => postRedemption(deps, request, reply))
}
