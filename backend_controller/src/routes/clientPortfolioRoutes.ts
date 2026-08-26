/**
 * Client portfolio routes. Native bearer transport; every handler re-resolves
 * the principal, so a suspended or closed account cannot read.
 *
 *   GET  /v1/client/portfolio      "My Investment" + per-fund breakdown
 *   GET  /v1/client/transactions   the dated value ledger behind those figures
 *   GET  /v1/client/orders         the client's order history
 *   GET  /v1/client/payments/:id   owner-scoped payment status
 *
 * Every figure is derived from the client's value ledger on each read — Total
 * Investment, Current Value, Total Growth, Return %. Nothing is cached and no
 * balance is stored, so the dashboard cannot drift from the events that
 * produced it.
 *
 * Order and payment responses expose only the client-safe status projection
 * (spec §9.2), never the raw internal state enums.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { Database } from "../db/types.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import {
  projectOrderStatus,
  projectPaymentStatus,
} from "../domain/client/clientStatus.js"
import {
  deriveInvestingEligibility,
  type EligibilityInputs,
} from "../domain/client/investingEligibility.js"
import { derivePortfolio } from "../domain/client/portfolioLedger.js"
import { toLedgerEntries } from "../domain/client/portfolioProjection.js"
import { computeFilterHash, decodeCursor, encodeCursor } from "../http/cursor.js"
import type { PageMeta } from "../http/envelope.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type {
  ClientPortfolioReadRepository,
  OrderRow,
  PaymentDetailRow,
} from "../repositories/clientPortfolioRepository.js"
import type {
  ClientValueEntryRepository,
  ClientValueEntryRow,
} from "../repositories/clientValueEntryRepository.js"

export interface ClientPortfolioConfig {
  readonly cursorKey: Buffer
}

export interface ClientPortfolioDeps extends NativeRequestAuthDeps {
  readonly clientPortfolioRepository: ClientPortfolioReadRepository
  readonly clientValueEntryRepository: ClientValueEntryRepository
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: ClientPortfolioConfig
}

const ORDERS_ROUTE = "/v1/client/orders"
const PORTFOLIO_ROUTE = "/v1/client/portfolio"
const TRANSACTIONS_ROUTE = "/v1/client/transactions"
const MAX_TRANSACTIONS = 200

const historyQuerySchema = z
  .object({ after: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) })
  .strict()

const transactionsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(MAX_TRANSACTIONS).default(50) })
  .strict()

const uuidParam = z.string().uuid()

const iso = (value: Date | string): string => new Date(value).toISOString()
const isoOrNull = (value: Date | string | null): string | null => (value === null ? null : iso(value))

const mapOrder = (row: OrderRow): Record<string, unknown> => ({
  orderId: row.id,
  fundId: row.fundId,
  sipPlanId: row.sipPlanId,
  type: row.type,
  status: projectOrderStatus(row.state),
  amountPaise: row.amountPaise,
  currency: row.currency,
  requestedAt: iso(row.requestedAt),
  paymentConfirmedAt: isoOrNull(row.paymentConfirmedAt),
  acceptedAt: isoOrNull(row.acceptedAt),
  cancelledAt: isoOrNull(row.cancelledAt),
  failureCode: row.failureCode,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

/** One ledger row as the investor's transaction list shows it. */
const mapTransaction = (row: ClientValueEntryRow): Record<string, unknown> => ({
  id: row.id,
  fundId: row.fundId,
  type: row.entryType === "contribution"
    ? row.orderType ?? "lump_sum"
    : row.entryType === "growth_adjustment" ? "gain_allocation" : "adjustment",
  // Signed deltas explain how the row moved each headline figure.
  principalDeltaPaise: row.principalDeltaPaise,
  valueDeltaPaise: row.valueDeltaPaise,
  date: row.effectiveDate,
  orderId: row.orderId,
  createdAt: iso(row.createdAt),
})

const mapPayment = (payment: PaymentDetailRow): Record<string, unknown> => ({
  paymentId: payment.id,
  orderId: payment.orderId,
  fundId: payment.fundId,
  amountPaise: payment.amountPaise,
  currency: payment.currency,
  status: projectPaymentStatus(payment.state, payment.orderState),
  provider: payment.provider,
  attemptStatus: payment.attemptState,
  failureCode: payment.failureCode,
  expiresAt: isoOrNull(payment.expiresAt),
  succeededAt: isoOrNull(payment.succeededAt),
  failedAt: isoOrNull(payment.failedAt),
  refundedAt: isoOrNull(payment.refundedAt),
  confirmedAt: isoOrNull(payment.acceptedAt),
  createdAt: iso(payment.createdAt),
  updatedAt: iso(payment.updatedAt),
})

const getEligibility = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const now = deps.clock()
  const inputsRow = await deps.clientPortfolioRepository.eligibilityInputs(deps.database, principal.userId)
  if (inputsRow === null) throw new AppError("RESOURCE_NOT_FOUND")

  const inputs: EligibilityInputs = {
    accountState: inputsRow.accountState,
    emailVerification:
      inputsRow.emailVerificationState === null
        ? null
        : { state: inputsRow.emailVerificationState, expiresAt: isoOrNull(inputsRow.emailVerificationExpiresAt) },
    now,
  }
  const decision = deriveInvestingEligibility(inputs)
  return reply.sendData(
    {
      eligibility: decision.eligibility,
      reason: decision.reason,
      canInvest: decision.eligibility === "eligible",
      emailVerificationState: inputsRow.emailVerificationState,
      evaluatedAt: iso(now),
    },
    { status: 200 },
  )
}

/**
 * "My Investment" headline plus a per-fund breakdown, all folded from the
 * client value ledger.
 */
const getPortfolio = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const rows = await deps.clientValueEntryRepository.listByUser(deps.database, principal.userId)
  const entries = toLedgerEntries(rows)
  const summary = derivePortfolio(entries)

  const fundIds = [...new Set(entries.map((entry) => entry.fundId))]
  const contributionBreakdown = (sourceRows: readonly ClientValueEntryRow[]) => {
    const contributions = sourceRows.filter((row) => row.entryType === "contribution")
    const sipRows = contributions.filter((row) => row.orderType === "sip_installment")
    const lumpRows = contributions.filter((row) => row.orderType === "lump_sum")
    const total = (items: readonly ClientValueEntryRow[]) =>
      items.reduce((sum, row) => sum + BigInt(row.principalDeltaPaise), 0n).toString()
    return {
      sipInstallmentCount: sipRows.length,
      sipTotalPaise: total(sipRows),
      lumpSumCount: lumpRows.length,
      lumpSumTotalPaise: total(lumpRows),
    }
  }
  const pools = fundIds.map((fundId) => {
    const perFund = derivePortfolio(entries.filter((entry) => entry.fundId === fundId))
    const breakdown = contributionBreakdown(rows.filter((row) => row.fundId === fundId))
    return {
      fundId,
      totalInvestmentPaise: perFund.totalInvestmentPaise.toString(),
      currentValuePaise: perFund.currentValuePaise.toString(),
      totalGrowthPaise: perFund.totalGrowthPaise.toString(),
      returnPercent: perFund.returnPercent,
      contributionCount: perFund.contributionCount,
      contributionTotalPaise: perFund.contributionTotalPaise.toString(),
      growthAdjustmentTotalPaise: perFund.growthAdjustmentTotalPaise.toString(),
      firstContributionDate: perFund.firstContributionDate,
      lastActivityDate: perFund.lastActivityDate,
      firstInvestmentDate: perFund.firstContributionDate,
      allocatedGainPaise: perFund.growthAdjustmentTotalPaise.toString(),
      redeemedTotalPaise: "0",
      ...breakdown,
    }
  })
  const breakdown = contributionBreakdown(rows)

  return reply.sendData(
    {
      currentValuePaise: summary.currentValuePaise.toString(),
      totalInvestmentPaise: summary.totalInvestmentPaise.toString(),
      totalGrowthPaise: summary.totalGrowthPaise.toString(),
      returnPercent: summary.returnPercent,
      returnSince: summary.firstContributionDate,
      lastUpdated: summary.lastActivityDate,
      summary: {
        contributionCount: summary.contributionCount,
        contributionTotalPaise: summary.contributionTotalPaise.toString(),
        growthAdjustmentTotalPaise: summary.growthAdjustmentTotalPaise.toString(),
        reversalCount: summary.reversalCount,
        allocatedGainPaise: summary.growthAdjustmentTotalPaise.toString(),
        redeemedTotalPaise: "0",
        redemptionCount: 0,
        ...breakdown,
      },
      pools,
    },
    { status: 200 },
  )
}

const listTransactions = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const query = parseOrThrow(transactionsQuerySchema, request.query)
  const rows = await deps.clientValueEntryRepository.listRecentByUser(
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
  return reply.sendData({ payment: mapPayment(payment) }, { status: 200 })
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
}
