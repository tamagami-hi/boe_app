import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { refuseFutureDate } from "../domain/shared/calendarDate.js"
import { RECORDING_CATEGORY_TEXT, recordingCategoryOf } from "../domain/shared/recordingCategory.js"
import { createdAtKeyset, paginate, readKeyset, readKeysetValues } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type {
  AccountingReportRepository,
  ClientBalanceRow,
  MonthContributionRow,
} from "../repositories/accountingReportRepository.js"
import { computeFilterHash, iso, isoOrNull, limitSchema } from "./adminRouteKit.js"
import { calendarDateSchema, calendarMonthSchema, readUuidPairKeyset } from "./reportParams.js"

const CLIENT_BALANCES_ROUTE = "/v1/admin/reports/client-balances"
const CONTRIBUTIONS_ROUTE = "/v1/admin/reports/contributions"

const REPORT_PERMISSIONS = ["client_values.read"] as const

const ONLINE_ORDER_LABEL: Readonly<Record<string, string>> = {
  lump_sum: "One-off investment",
  sip_installment: "SIP instalment",
}
const UNLINKED_CONTRIBUTION_LABEL = "Contribution"

export interface AdminReportDeps {
  readonly webAuth: WebAuthDeps
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: { readonly cursorKey: Buffer }
  readonly accountingReportRepository: AccountingReportRepository
}

const pageQuery = { after: z.string().min(1).optional(), limit: limitSchema }

const balancesQuerySchema = z.object({ asOfDate: calendarDateSchema, ...pageQuery }).strict()

const contributionsQuerySchema = z.object({ month: calendarMonthSchema, ...pageQuery }).strict()

const categoryLabelOf = (row: MonthContributionRow): string => {
  if (row.orderType === "recorded_offline") return RECORDING_CATEGORY_TEXT[recordingCategoryOf(row.reasonCode)].label
  return ONLINE_ORDER_LABEL[row.orderType ?? ""] ?? UNLINKED_CONTRIBUTION_LABEL
}

const balanceBody = (row: ClientBalanceRow) => ({
  userId: row.userId,
  clientName: row.clientName,
  clientEmail: row.clientEmail,
  fundId: row.fundId,
  fundName: row.fundName,
  investedPaise: row.investedPaise,
  valuePaise: row.valuePaise,
})

const contributionBody = (row: MonthContributionRow) => ({
  entryId: row.entryId,
  userId: row.userId,
  clientName: row.clientName,
  clientEmail: row.clientEmail,
  fundId: row.fundId,
  fundName: row.fundName,
  categoryLabel: categoryLabelOf(row),
  amountPaise: row.amountPaise,
  effectiveDate: row.effectiveDate,
  recordedAt: iso(row.recordedAt),
  reversedAt: isoOrNull(row.reversedAt),
})

const authorize = async (deps: AdminReportDeps, request: FastifyRequest): Promise<void> => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, REPORT_PERMISSIONS)
}

const listClientBalances = async (deps: AdminReportDeps, request: FastifyRequest, reply: FastifyReply) => {
  await authorize(deps, request)
  const query = parseOrThrow(balancesQuerySchema, request.query)
  const now = deps.clock()
  refuseFutureDate("asOfDate", query.asOfDate, now)
  const filterHash = computeFilterHash({ asOfDate: query.asOfDate })
  const after = readUuidPairKeyset(
    readKeysetValues(deps.config.cursorKey, query.after, CLIENT_BALANCES_ROUTE, filterHash, now),
  )
  const rows = await deps.accountingReportRepository.listClientBalances(deps.database, {
    asOfDate: query.asOfDate,
    limit: query.limit + 1,
    after: after === null ? null : { userId: after.first, fundId: after.second },
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    CLIENT_BALANCES_ROUTE,
    filterHash,
    now,
    (row) => [row.userId, row.fundId],
  )
  return reply.sendData({ asOfDate: query.asOfDate, items: items.map(balanceBody) }, { status: 200, page })
}

const listMonthContributions = async (deps: AdminReportDeps, request: FastifyRequest, reply: FastifyReply) => {
  await authorize(deps, request)
  const query = parseOrThrow(contributionsQuerySchema, request.query)
  const now = deps.clock()
  const monthStart = `${query.month}-01`
  refuseFutureDate("month", monthStart, now)
  const filterHash = computeFilterHash({ month: query.month })
  const boundary = readKeyset(deps.config.cursorKey, query.after, CONTRIBUTIONS_ROUTE, filterHash, now)
  const rows = await deps.accountingReportRepository.listMonthContributions(deps.database, {
    ...boundary,
    monthStart,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    CONTRIBUTIONS_ROUTE,
    filterHash,
    now,
    (row) => createdAtKeyset({ id: row.entryId, cursorAt: row.cursorAt }),
  )
  return reply.sendData({ month: query.month, items: items.map(contributionBody) }, { status: 200, page })
}

export const registerAdminReportRoutes = (application: FastifyInstance, deps: AdminReportDeps): void => {
  application.get(CLIENT_BALANCES_ROUTE, (request, reply) => listClientBalances(deps, request, reply))
  application.get(CONTRIBUTIONS_ROUTE, (request, reply) => listMonthContributions(deps, request, reply))
}
