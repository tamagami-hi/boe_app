import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  foldClientValues,
  summarizeClientReturns,
  withXirr,
  type ClientReturns,
  type ClientValueFold,
  type LedgerFact,
} from "../domain/admin/clientReturns.js"
import { isEntryReversible } from "../domain/admin/reverseLedgerEntry.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { indiaCalendarDate } from "../domain/shared/calendarDate.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeysetValues } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { ClientPositionRepository, LedgerEntryRow } from "../repositories/clientPositionRepository.js"
import type { ClientReturnsRepository, UserLedgerFact } from "../repositories/clientReturnsRepository.js"
import { computeFilterHash, iso, isoOrNull, limitSchema, uuidParam } from "./adminRouteKit.js"

const PORTFOLIO_SUMMARY_ROUTE = "/v1/admin/clients/:userId/portfolio-summary"
const VALUE_SUMMARY_ROUTE = "/v1/admin/client-values/summary"
const FUND_UPDATES_ROUTE = "/v1/admin/client-values/fund-updates"
const PENDING_INVITES_ROUTE = "/v1/admin/overview/pending-invites"
const LEDGER_PAGE_ROUTE = "/v1/admin/clients/:userId/ledger"

const RETURNS_PERMISSIONS = ["client_values.read"] as const
const LEDGER_PERMISSIONS = ["client_position.write", "client_values.read"] as const
const INVITE_PERMISSIONS = ["users.read", "clients.password_links.send"] as const

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
const USER_IDS_PATTERN = new RegExp(`^${UUID_PATTERN}(,${UUID_PATTERN}){0,99}$`, "u")
const BASIS_POINTS_KEY = /^(null|-?(0|[1-9][0-9]*))$/u

export interface AdminClientReturnDeps {
  readonly webAuth: WebAuthDeps
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: { readonly cursorKey: Buffer }
  readonly clientReturnsRepository: ClientReturnsRepository
  readonly clientPositionRepository: Pick<ClientPositionRepository, "listLedgerEntriesAfter">
}

const summaryQuerySchema = z
  .object({
    sort: z.enum(["return_desc", "return_asc"]).default("return_desc"),
    userIds: z.string().regex(USER_IDS_PATTERN).optional(),
    after: z.string().min(1).optional(),
    limit: limitSchema,
  })
  .strict()

const ledgerQuerySchema = z
  .object({ fundId: uuidParam.optional(), after: z.string().min(1).optional(), limit: limitSchema })
  .strict()

type SummarySort = z.infer<typeof summaryQuerySchema>["sort"]

interface ClientSummaryRow {
  readonly userId: string
  readonly facts: readonly LedgerFact[]
  readonly fold: ClientValueFold
}

interface SummaryPosition {
  readonly userId: string
  readonly basisPoints: bigint | null
}

const userIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)

const basisPointsOrNull = (value: bigint | null): string | null => (value === null ? null : value.toString())

const returnsBody = (returns: ClientReturns) => ({
  investedPaise: returns.investedPaise.toString(),
  currentValuePaise: returns.currentValuePaise.toString(),
  growthPaise: returns.growthPaise.toString(),
  simpleReturnBasisPoints: basisPointsOrNull(returns.simpleReturnBasisPoints),
  xirrBasisPoints: basisPointsOrNull(returns.xirrBasisPoints),
  lastUpdatedAt: isoOrNull(returns.lastUpdatedAt),
})

export const ledgerEntryBody = (row: LedgerEntryRow) => ({
  entryId: row.id,
  fundId: row.fundId,
  entryType: row.entryType,
  orderType: row.orderType,
  principalDeltaPaise: row.principalDeltaPaise.toString(),
  valueDeltaPaise: row.valueDeltaPaise.toString(),
  effectiveDate: row.effectiveDate,
  reasonCode: row.reasonCode,
  reversesEntryId: row.reversesEntryId,
  reversedByEntryId: row.reversedByEntryId,
  reversible: isEntryReversible(row),
  createdAt: row.createdAt.toISOString(),
})

const compareSummaries =
  (sort: SummarySort) =>
  (left: SummaryPosition, right: SummaryPosition): number => {
    if (left.basisPoints !== right.basisPoints) {
      if (left.basisPoints === null) return 1
      if (right.basisPoints === null) return -1
      const descending = left.basisPoints > right.basisPoints ? -1 : 1
      return sort === "return_desc" ? descending : -descending
    }
    if (left.userId === right.userId) return 0
    return left.userId < right.userId ? -1 : 1
  }

const positionOf = (row: ClientSummaryRow): SummaryPosition => ({
  userId: row.userId,
  basisPoints: row.fold.simpleReturnBasisPoints,
})

const cursorPosition = (values: readonly string[]): SummaryPosition | null => {
  if (values.length === 0) return null
  const [basisPoints, userId] = values
  if (basisPoints === undefined || userId === undefined || !BASIS_POINTS_KEY.test(basisPoints)) {
    throw new AppError("CURSOR_INVALID")
  }
  return { userId, basisPoints: basisPoints === "null" ? null : BigInt(basisPoints) }
}

const groupByUser = (facts: readonly UserLedgerFact[]): ReadonlyMap<string, readonly LedgerFact[]> =>
  facts.reduce((groups, fact) => {
    groups.set(fact.userId, [...(groups.get(fact.userId) ?? []), fact])
    return groups
  }, new Map<string, LedgerFact[]>())

const loadSummaryScope = async (
  deps: AdminClientReturnDeps,
  requestedIds: readonly string[] | null,
): Promise<Readonly<{ userIds: readonly string[]; facts: readonly UserLedgerFact[] }>> => {
  if (requestedIds === null) {
    const facts = await deps.clientReturnsRepository.listLedgerFacts(deps.database, null)
    return { userIds: [...new Set(facts.map((fact) => fact.userId))], facts }
  }
  const userIds = await deps.clientReturnsRepository.listExistingUserIds(deps.database, requestedIds)
  const facts = await deps.clientReturnsRepository.listLedgerFacts(deps.database, userIds)
  return { userIds, facts }
}

const portfolioSummary = async (deps: AdminClientReturnDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, RETURNS_PERMISSIONS)
  const userId = userIdOf(request)
  const existing = await deps.clientReturnsRepository.listExistingUserIds(deps.database, [userId])
  if (existing.length === 0) throw new AppError("RESOURCE_NOT_FOUND")
  const facts = await deps.clientReturnsRepository.listLedgerFacts(deps.database, [userId])
  const asOfDate = indiaCalendarDate(deps.clock())
  return reply.sendData(
    { userId, asOfDate, ...returnsBody(summarizeClientReturns(facts, asOfDate)) },
    { status: 200 },
  )
}

const valueSummaries = async (deps: AdminClientReturnDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, RETURNS_PERMISSIONS)
  const query = parseOrThrow(summaryQuerySchema, request.query)
  const requestedIds =
    query.userIds === undefined ? null : [...new Set(query.userIds.toLowerCase().split(","))].sort()
  const now = deps.clock()
  const asOfDate = indiaCalendarDate(now)
  const filterHash = computeFilterHash({ sort: query.sort, userIds: requestedIds?.join(",") ?? null })
  const after = cursorPosition(
    readKeysetValues(deps.config.cursorKey, query.after, VALUE_SUMMARY_ROUTE, filterHash, now),
  )

  const scope = await loadSummaryScope(deps, requestedIds)
  const groups = groupByUser(scope.facts)
  const compare = compareSummaries(query.sort)
  const rows = scope.userIds
    .map((userId) => {
      const facts = groups.get(userId) ?? []
      return { userId, facts, fold: foldClientValues(facts) }
    })
    .sort((left, right) => compare(positionOf(left), positionOf(right)))
  const remaining = after === null ? rows : rows.filter((row) => compare(positionOf(row), after) > 0)
  const { items, page } = paginate(
    deps.config.cursorKey,
    remaining.slice(0, query.limit + 1),
    query.limit,
    VALUE_SUMMARY_ROUTE,
    filterHash,
    now,
    (row) => [basisPointsOrNull(row.fold.simpleReturnBasisPoints) ?? "null", row.userId],
  )

  return reply.sendData(
    {
      asOfDate,
      totals: { clientCount: scope.userIds.length, ...returnsBody(summarizeClientReturns(scope.facts, asOfDate)) },
      items: items.map((row) => ({ userId: row.userId, ...returnsBody(withXirr(row.fold, row.facts, asOfDate)) })),
    },
    { status: 200, page },
  )
}

const fundValueUpdates = async (deps: AdminClientReturnDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, RETURNS_PERMISSIONS)
  const rows = await deps.clientReturnsRepository.listFundValueUpdates(deps.database)
  return reply.sendData(
    {
      items: rows.map((row) => ({
        fundId: row.fundId,
        fundSlug: row.fundSlug,
        fundName: row.fundName,
        lastValueUpdateAt: isoOrNull(row.lastValueUpdateAt),
        lastValueUpdateEffectiveDate: row.lastValueUpdateEffectiveDate,
      })),
    },
    { status: 200 },
  )
}

const pendingInvites = async (deps: AdminClientReturnDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, INVITE_PERMISSIONS)
  const invites = await deps.clientReturnsRepository.countPendingInvites(deps.database)
  return reply.sendData(
    { count: invites.count, oldestInvitedAt: invites.oldestInvitedAt === null ? null : iso(invites.oldestInvitedAt) },
    { status: 200 },
  )
}

const ledgerPage = async (deps: AdminClientReturnDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, LEDGER_PERMISSIONS)
  const userId = userIdOf(request)
  const query = parseOrThrow(ledgerQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId, fundId: query.fundId ?? null })
  const [afterEntryId] = readKeysetValues(deps.config.cursorKey, query.after, LEDGER_PAGE_ROUTE, filterHash, now)
  if (afterEntryId !== undefined && !uuidParam.safeParse(afterEntryId).success) throw new AppError("CURSOR_INVALID")

  const rows = await deps.clientPositionRepository.listLedgerEntriesAfter(deps.database, {
    userId,
    fundId: query.fundId ?? null,
    afterEntryId: afterEntryId ?? null,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(deps.config.cursorKey, rows, query.limit, LEDGER_PAGE_ROUTE, filterHash, now, (row) => [
    row.id,
  ])
  return reply.sendData({ userId, items: items.map(ledgerEntryBody) }, { status: 200, page })
}

export const registerAdminClientReturnRoutes = (application: FastifyInstance, deps: AdminClientReturnDeps): void => {
  application.get(PORTFOLIO_SUMMARY_ROUTE, (request, reply) => portfolioSummary(deps, request, reply))
  application.get(VALUE_SUMMARY_ROUTE, (request, reply) => valueSummaries(deps, request, reply))
  application.get(FUND_UPDATES_ROUTE, (request, reply) => fundValueUpdates(deps, request, reply))
  application.get(PENDING_INVITES_ROUTE, (request, reply) => pendingInvites(deps, request, reply))
  application.get(LEDGER_PAGE_ROUTE, (request, reply) => ledgerPage(deps, request, reply))
}
