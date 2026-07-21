/**
 * Client portfolio read routes (spec 03 §2.3, §4.3; spec 04 §3, §4.5). Native
 * bearer transport: every handler resolves and re-checks the native principal,
 * so a suspended/closed/invited account (or an invalid session) is rejected
 * before any row is read. All three endpoints are read-only and run outside the
 * idempotency protocol.
 *
 *   GET /v1/client/eligibility  derived investing eligibility (never stored)
 *   GET /v1/client/holdings     authoritative holdings valued at current NAV
 *   GET /v1/client/orders       the client's investment-order history
 *
 * List endpoints use the authenticated opaque keyset cursor over
 * `(created_at DESC, id DESC)` with a validated limit no greater than 100.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import {
  deriveInvestingEligibility,
  type EligibilityInputs,
} from "../domain/client/investingEligibility.js"
import { computeFilterHash, decodeCursor, encodeCursor } from "../http/cursor.js"
import type { PageMeta } from "../http/envelope.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type {
  ClientPortfolioReadRepository,
  HoldingPositionRow,
  OrderRow,
} from "../repositories/clientPortfolioRepository.js"

export interface ClientPortfolioConfig {
  readonly cursorKey: Buffer
}

export interface ClientPortfolioDeps extends NativeRequestAuthDeps {
  readonly clientPortfolioRepository: ClientPortfolioReadRepository
  readonly clock: () => Date
  readonly config: ClientPortfolioConfig
}

const HOLDINGS_ROUTE = "/v1/client/holdings"
const ORDERS_ROUTE = "/v1/client/orders"

const historyQuerySchema = z
  .object({
    after: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

const iso = (value: Date | string): string => new Date(value).toISOString()
const isoOrNull = (value: Date | string | null): string | null => (value === null ? null : iso(value))

interface KeysetPosition {
  readonly afterCreatedAt?: Date
  readonly afterId?: string
}

const readKeyset = (
  deps: ClientPortfolioDeps,
  after: string | undefined,
  route: string,
  filterHash: string,
  now: Date,
): KeysetPosition => {
  if (after === undefined) return {}
  const parts = decodeCursor(deps.config.cursorKey, after, { route, filterHash, now })
  const createdAtRaw = parts[0]
  const idRaw = parts[1]
  if (createdAtRaw === undefined || idRaw === undefined) throw new AppError("CURSOR_INVALID")
  return { afterCreatedAt: new Date(createdAtRaw), afterId: idRaw }
}

interface Paginated<Row> {
  readonly items: readonly Row[]
  readonly page: PageMeta
}

const paginate = <Row>(
  deps: ClientPortfolioDeps,
  rows: readonly Row[],
  limit: number,
  route: string,
  filterHash: string,
  now: Date,
  sortValues: (row: Row) => readonly string[],
): Paginated<Row> => {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor(deps.config.cursorKey, { route, filterHash, sortValues: sortValues(last), now })
      : null
  return { items, page: { nextCursor, limit, hasMore } }
}

const mapHolding = (row: HoldingPositionRow): Record<string, unknown> => ({
  holdingId: row.id,
  fundId: row.fundId,
  fundSlug: row.fundSlug,
  fundState: row.fundState,
  fundName: row.fundName,
  fundCategory: row.fundCategory,
  fundRiskLevel: row.fundRiskLevel,
  currency: row.currency,
  totalUnits: row.totalUnits,
  reservedUnits: row.reservedUnits,
  availableUnits: row.availableUnits,
  costBasisPaise: row.costBasisPaise,
  currentNav: row.currentNav,
  navAsOfDate: row.navAsOfDate,
  marketValuePaise: row.marketValuePaise,
  version: Number(row.version),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

const mapOrder = (row: OrderRow): Record<string, unknown> => ({
  orderId: row.id,
  fundId: row.fundId,
  sipPlanId: row.sipPlanId,
  type: row.type,
  status: row.state,
  amountPaise: row.amountPaise,
  requestedUnits: row.requestedUnits,
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
    riskState: inputsRow.riskState,
    now,
  }
  const decision = deriveInvestingEligibility(inputs)
  return reply.sendData(
    {
      eligibility: decision.eligibility,
      reason: decision.reason,
      canInvest: decision.eligibility === "eligible",
      kycState: inputsRow.kycState,
      riskState: inputsRow.riskState,
      evaluatedAt: iso(now),
    },
    { status: 200 },
  )
}

const listHoldings = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const query = parseOrThrow(historyQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId: principal.userId })
  const keyset = readKeyset(deps, query.after, HOLDINGS_ROUTE, filterHash, now)

  const rows = await deps.clientPortfolioRepository.listHoldings(deps.database, {
    userId: principal.userId,
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(deps, rows, query.limit, HOLDINGS_ROUTE, filterHash, now, (row) => [
    iso(row.createdAt),
    row.id,
  ])
  return reply.sendData({ items: items.map(mapHolding) }, { status: 200, page })
}

const listOrders = async (deps: ClientPortfolioDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const query = parseOrThrow(historyQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId: principal.userId })
  const keyset = readKeyset(deps, query.after, ORDERS_ROUTE, filterHash, now)

  const rows = await deps.clientPortfolioRepository.listOrders(deps.database, {
    userId: principal.userId,
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(deps, rows, query.limit, ORDERS_ROUTE, filterHash, now, (row) => [
    iso(row.createdAt),
    row.id,
  ])
  return reply.sendData({ items: items.map(mapOrder) }, { status: 200, page })
}

export const registerClientPortfolioRoutes = (
  application: FastifyInstance,
  deps: ClientPortfolioDeps,
): void => {
  application.get("/v1/client/eligibility", async (request, reply) => getEligibility(deps, request, reply))
  application.get(HOLDINGS_ROUTE, async (request, reply) => listHoldings(deps, request, reply))
  application.get(ORDERS_ROUTE, async (request, reply) => listOrders(deps, request, reply))
}
