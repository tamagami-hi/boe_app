/**
 * Admin fund routes — Option B (spec 04 §3.2; model document modules 5-6).
 * Web-cookie transport, RBAC (`funds.read` to read, `funds.write` to change),
 * CSRF on unsafe methods.
 *
 *   GET    /v1/admin/funds                     pools with their current AUM + stock count
 *   GET    /v1/admin/funds/:id                 detail: versions, AUM history, stock list
 *   POST   /v1/admin/funds                     create a draft pool (slug only)
 *   POST   /v1/admin/funds/:id/versions        publish a version (terms + disclosure; no price)
 *   POST   /v1/admin/funds/:id/aum-updates     publish the month's AUM
 *   GET    /v1/admin/funds/:id/stocks          the disclosed stock list
 *   POST   /v1/admin/funds/:id/stocks          add a stock, tagged with its quarter
 *   PATCH  /v1/admin/funds/:id/stocks/:stockId edit a stock
 *   DELETE /v1/admin/funds/:id/stocks/:stockId mark a stock exited (never deleted)
 *   PATCH  /v1/admin/funds/:id                 lifecycle: published | paused | archived
 *   DELETE /v1/admin/funds/:id                 archive
 *
 * Deliberately absent: NAV publication and unit-priced position percentages. This
 * model has no per-unit price — a pool's size is the monthly AUM figure and its
 * composition is the administrator-curated stock list. Investor growth is
 * allocated per investor (see the gain-allocation route), not derived from a price.
 *
 * The monthly AUM figure is *derived*, never typed: the opening balance comes from
 * the previous month's closing, and the closing balance is computed as
 * `opening + new investments - redemptions +/- portfolio gain`. A second update
 * for the same month is refused rather than silently overwriting published
 * history.
 */
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  splitPoolGainByAmount,
  splitPoolGainByPercent,
  type PoolMember,
} from "../domain/admin/poolGainDistribution.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { allocateGain } from "../domain/client/allocateGain.js"
import { deriveClosingAum, derivePortfolio } from "../domain/client/portfolioLedger.js"
import { toLedgerEntries } from "../domain/client/portfolioProjection.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AdminCatalogRepository, FundListRow } from "../repositories/adminCatalogRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type {
  FundInvestorLedgerRow,
  InvestorLedgerRepository,
} from "../repositories/investorLedgerRepository.js"
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
  runAdminMutation,
  slugSchema,
  uuidParam,
} from "./adminRouteKit.js"

export interface AdminCatalogConfig {
  readonly cursorKey: Buffer
  readonly idempotencyTtlMs: number
}

export interface AdminCatalogDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: AdminCatalogConfig
  readonly catalogRepository: AdminCatalogRepository
  readonly investorLedgerRepository: InvestorLedgerRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

const FUNDS_ROUTE = "/v1/admin/funds"
const HISTORY_LIMIT = 36

// --- schemas ---

const listQuerySchema = z.object({ after: z.string().min(1).optional(), limit: limitSchema }).strict()
const paiseSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const signedPaiseSchema = z.coerce
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
const shortText = z.string().trim().max(200)
const longText = z.string().trim().max(20000)
/** First day of a month, e.g. 2026-07-01. */
const monthStart = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-01$/u, "must be the first day of a month (YYYY-MM-01)")
/** Reporting quarter label, e.g. Q1 FY27. */
const quarterLabel = z
  .string()
  .trim()
  .regex(/^Q[1-4] FY\d{2}$/u, "must look like 'Q1 FY27'")

const createFundSchema = z.object({ slug: slugSchema }).strict()

const publishVersionSchema = z
  .object({
    name: shortText.min(1),
    category: shortText.min(1),
    objective: longText.default(""),
    riskLevel: z.enum(["low", "moderate", "high", "very_high"]),
    returnTier: z.enum(["low", "moderate", "high"]).nullish(),
    minimumSipPaise: paiseSchema.default(0),
    minimumPurchasePaise: paiseSchema.default(0),
    minimumDurationMonths: z.coerce.number().int().positive().max(1200).nullish(),
    recommendedHoldingMonths: z.coerce.number().int().positive().max(1200).nullish(),
    disclosure: z.object({ title: shortText.min(1), body: longText.min(1) }).strict(),
  })
  .strict()

const aumUpdateSchema = z
  .object({
    periodStart: monthStart,
    newInvestmentsPaise: paiseSchema.default(0),
    redemptionsPaise: paiseSchema.default(0),
    /** Signed: a loss is negative. */
    portfolioGainPaise: signedPaiseSchema.default(0),
    /** Required only for the very first period, when there is no previous closing. */
    openingAumPaise: paiseSchema.optional(),
    note: longText.optional(),
  })
  .strict()

const stockSchema = z
  .object({
    stockName: shortText.min(1),
    quarterLabel,
    weightPercent: z.coerce.number().min(0).max(100).nullish(),
    sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict()

const lifecycleSchema = z.object({ status: z.enum(["published", "paused", "archived"]) }).strict()

/**
 * Distribute a period's growth across a pool. The instruction is either a total
 * amount to hand out or a percentage each investor's own value grew by; exactly
 * one must be given, so an ambiguous request is refused rather than guessed at.
 *
 * `dryRun` returns the split without writing, which is what the admin panel's
 * preview uses before anyone commits money movements.
 */
const poolAllocationSchema = z
  .object({
    effectiveDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "must be an ISO calendar date (YYYY-MM-DD)"),
    reasonCode: reasonCodeSchema,
    note: z.string().trim().max(2000).optional(),
    /** Signed paise: negative distributes a loss. */
    totalGainPaise: signedPaiseSchema.optional(),
    /** Signed basis points: 350 is 3.50%. */
    growthBasisPoints: z.coerce.number().int().min(-1_000_000).max(1_000_000).optional(),
    dryRun: z.coerce.boolean().default(false),
  })
  .strict()
  .refine(
    (value) => (value.totalGainPaise === undefined) !== (value.growthBasisPoints === undefined),
    { message: "give either totalGainPaise or growthBasisPoints, not both" },
  )

// --- mappers ---

const mapFund = (row: FundListRow): Record<string, unknown> => ({
  id: row.id,
  slug: row.slug,
  status: row.state,
  name: row.name,
  category: row.category,
  objective: row.objective,
  riskLevel: row.riskLevel,
  returnTier: row.returnTier,
  currency: row.currency ?? "INR",
  minimumSipPaise: row.minimumSipPaise,
  minimumPurchasePaise: row.minimumPurchasePaise,
  currentVersion: row.currentVersion,
  currentVersionId: row.currentVersionId,
  // Pool size as last published, with the month it closed and when it was entered.
  aum:
    row.aumPaise === null
      ? null
      : {
          closingPaise: row.aumPaise,
          periodStart: row.aumPeriodStart,
          updatedAt: isoOrNull(row.aumUpdatedAt),
        },
  stockCount: row.stockCount,
  publishedAt: isoOrNull(row.publishedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

// --- shared mutation plumbing ---

const mutate = async <TBody extends Record<string, unknown>>(
  deps: AdminCatalogDeps,
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

const fundIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as { fundId?: unknown }).fundId)

// --- handlers ---

const listFunds = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["funds.read"])
  const query = parseOrThrow(listQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({})
  const keyset = readKeyset(deps.config.cursorKey, query.after, FUNDS_ROUTE, filterHash, now)

  const rows = await deps.catalogRepository.list(deps.database, { ...keyset, limit: query.limit + 1 })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    FUNDS_ROUTE,
    filterHash,
    now,
    (row) => [iso(row.createdAt), row.id],
  )
  return reply.sendData({ items: items.map(mapFund) }, { status: 200, page })
}

const getFund = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["funds.read"])
  const fundId = fundIdOf(request)

  const fund = await deps.catalogRepository.findOne(deps.database, fundId)
  if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")

  const [versions, aumHistory, stocks, disclosures, ledgerTotals] = await Promise.all([
    deps.catalogRepository.listVersions(deps.database, fundId),
    deps.catalogRepository.listAumUpdates(deps.database, fundId, HISTORY_LIMIT),
    deps.catalogRepository.listStocks(deps.database, fundId),
    deps.catalogRepository.listDisclosures(deps.database, fundId),
    deps.investorLedgerRepository.fundTotals(deps.database, fundId),
  ])

  return reply.sendData(
    {
      fund: mapFund(fund),
      versions: versions.map((version) => ({ ...version, createdAt: iso(version.createdAt) })),
      aumHistory: aumHistory.map((update) => ({ ...update, createdAt: iso(update.createdAt) })),
      stocks: stocks.map((stock) => ({
        ...stock,
        exitedAt: isoOrNull(stock.exitedAt),
        createdAt: iso(stock.createdAt),
        updatedAt: iso(stock.updatedAt),
      })),
      disclosures: disclosures.map((disclosure) => ({
        ...disclosure,
        effectiveFrom: iso(disclosure.effectiveFrom),
        createdAt: iso(disclosure.createdAt),
      })),
      // What investors actually hold in this pool, summed from their ledgers.
      investors: {
        count: ledgerTotals.investorCount,
        contributionsPaise: ledgerTotals.contributionsPaise,
        redemptionsPaise: ledgerTotals.redemptionsPaise,
        allocatedGainPaise: ledgerTotals.allocatedGainPaise,
        currentValuePaise: ledgerTotals.currentValuePaise,
      },
    },
    { status: 200 },
  )
}

const createFund = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.write"])
  const body = parseOrThrow(createFundSchema, request.body)

  return mutate(deps, request, reply, FUNDS_ROUTE, "POST", { slug: body.slug }, principal.userId, async (tx) => {
    if (await deps.catalogRepository.slugExists(tx, body.slug)) throw new AppError("STATE_CONFLICT")
    const fund = await deps.catalogRepository.insertFund(tx, {
      slug: body.slug,
      createdByUserId: principal.userId,
    })
    await deps.auditRepository.append(tx, {
      actorType: "admin",
      actorUserId: principal.userId,
      command: "fund.created",
      entityType: "fund",
      entityId: fund.id,
      toState: fund.state,
      requestId: request.requestId,
      entityVersion: Number(fund.version),
      metadata: { slug: fund.slug },
    })
    return {
      status: 201,
      body: { fund: { id: fund.id, slug: fund.slug, status: fund.state, createdAt: iso(fund.created_at) } },
    }
  })
}

const publishVersion = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.write"])
  const fundId = fundIdOf(request)
  const body = parseOrThrow(publishVersionSchema, request.body)
  const now = deps.clock()

  return mutate(
    deps,
    request,
    reply,
    `${FUNDS_ROUTE}/:fundId/versions`,
    "POST",
    { fundId, name: body.name, category: body.category },
    principal.userId,
    async (tx) => {
      const fund = await deps.catalogRepository.lock(tx, fundId)
      if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (fund.state === "archived") throw new AppError("STATE_CONFLICT")

      const disclosureVersion = await deps.catalogRepository.nextDisclosureVersion(tx, fundId)
      const disclosure = await deps.catalogRepository.insertDisclosure(tx, {
        fundId,
        version: disclosureVersion,
        title: body.disclosure.title,
        body: body.disclosure.body,
        contentSha256: createHash("sha256").update(body.disclosure.body, "utf8").digest(),
        effectiveFrom: now,
        publishedByUserId: principal.userId,
      })

      const version = await deps.catalogRepository.nextVersion(tx, fundId)
      const termsSha256 = createHash("sha256")
        .update(
          JSON.stringify({
            name: body.name,
            category: body.category,
            objective: body.objective,
            riskLevel: body.riskLevel,
            returnTier: body.returnTier ?? null,
            minimumSipPaise: body.minimumSipPaise,
            minimumPurchasePaise: body.minimumPurchasePaise,
            disclosureVersionId: disclosure.id,
          }),
          "utf8",
        )
        .digest()

      const created = await deps.catalogRepository.insertVersion(tx, {
        fundId,
        version,
        name: body.name,
        category: body.category,
        objective: body.objective,
        riskLevel: body.riskLevel,
        returnTier: body.returnTier ?? null,
        minimumSipPaise: String(body.minimumSipPaise),
        minimumPurchasePaise: String(body.minimumPurchasePaise),
        minimumDurationMonths: body.minimumDurationMonths ?? null,
        recommendedHoldingMonths: body.recommendedHoldingMonths ?? null,
        disclosureVersionId: disclosure.id,
        termsSha256,
        createdByUserId: principal.userId,
      })

      const published = await deps.catalogRepository.setCurrentVersion(tx, {
        fundId,
        versionId: created.id,
        now,
      })

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund.version_published",
        entityType: "fund",
        entityId: fundId,
        fromState: fund.state,
        toState: published.state,
        requestId: request.requestId,
        entityVersion: Number(published.version),
        metadata: { fundVersionId: created.id, version, disclosureVersionId: disclosure.id },
      })

      return {
        status: 201,
        body: {
          fundId,
          status: published.state,
          fundVersionId: created.id,
          version,
          disclosureVersionId: disclosure.id,
        },
      }
    },
  )
}

const publishAumUpdate = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.write"])
  const fundId = fundIdOf(request)
  const body = parseOrThrow(aumUpdateSchema, request.body)

  return mutate(
    deps,
    request,
    reply,
    `${FUNDS_ROUTE}/:fundId/aum-updates`,
    "POST",
    { fundId, periodStart: body.periodStart },
    principal.userId,
    async (tx) => {
      const fund = await deps.catalogRepository.lock(tx, fundId)
      if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")

      const previous = await deps.catalogRepository.latestAumUpdate(tx, fundId)
      // Publishing an earlier or repeated period would rewrite history.
      if (previous !== null && body.periodStart <= previous.periodStart) {
        throw new AppError("STATE_CONFLICT")
      }
      // The opening balance is the previous closing; only the first period may
      // state one explicitly.
      const openingAumPaise =
        previous !== null
          ? BigInt(previous.closingAumPaise)
          : BigInt(body.openingAumPaise ?? 0)

      const closing = deriveClosingAum({
        openingAumPaise,
        newInvestmentsPaise: BigInt(body.newInvestmentsPaise),
        redemptionsPaise: BigInt(body.redemptionsPaise),
        portfolioGainPaise: BigInt(body.portfolioGainPaise),
      })

      const update = await deps.catalogRepository.insertAumUpdate(tx, {
        fundId,
        periodStart: body.periodStart,
        openingAumPaise: openingAumPaise.toString(),
        newInvestmentsPaise: String(body.newInvestmentsPaise),
        redemptionsPaise: String(body.redemptionsPaise),
        portfolioGainPaise: String(body.portfolioGainPaise),
        closingAumPaise: closing.toString(),
        note: body.note ?? null,
        publishedByUserId: principal.userId,
        requestId: request.requestId,
      })

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund.aum_updated",
        entityType: "fund_aum_update",
        entityId: update.id,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: {
          fundId,
          periodStart: update.periodStart,
          closingAumPaise: update.closingAumPaise,
        },
      })

      return { status: 201, body: { fundId, aumUpdate: { ...update, createdAt: iso(update.createdAt) } } }
    },
  )
}

const listStocks = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["funds.read"])
  const fundId = fundIdOf(request)
  const stocks = await deps.catalogRepository.listStocks(deps.database, fundId)
  return reply.sendData(
    {
      items: stocks.map((stock) => ({
        ...stock,
        exitedAt: isoOrNull(stock.exitedAt),
        createdAt: iso(stock.createdAt),
        updatedAt: iso(stock.updatedAt),
      })),
    },
    { status: 200 },
  )
}

const addStock = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.write"])
  const fundId = fundIdOf(request)
  const body = parseOrThrow(stockSchema, request.body)

  return mutate(
    deps,
    request,
    reply,
    `${FUNDS_ROUTE}/:fundId/stocks`,
    "POST",
    { fundId, stockName: body.stockName, quarterLabel: body.quarterLabel },
    principal.userId,
    async (tx) => {
      const fund = await deps.catalogRepository.lock(tx, fundId)
      if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")
      const stock = await deps.catalogRepository.insertStock(tx, {
        fundId,
        stockName: body.stockName,
        quarterLabel: body.quarterLabel,
        weightPercent: body.weightPercent === null || body.weightPercent === undefined
          ? null
          : String(body.weightPercent),
        sortOrder: body.sortOrder,
        addedByUserId: principal.userId,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund.stock_added",
        entityType: "fund_stock_disclosure",
        entityId: stock.id,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: { fundId, stockName: stock.stockName, quarterLabel: stock.quarterLabel },
      })
      return {
        status: 201,
        body: {
          stock: {
            ...stock,
            exitedAt: isoOrNull(stock.exitedAt),
            createdAt: iso(stock.createdAt),
            updatedAt: iso(stock.updatedAt),
          },
        },
      }
    },
  )
}

const editStock = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.write"])
  const fundId = fundIdOf(request)
  const stockId = parseOrThrow(uuidParam, (request.params as { stockId?: unknown }).stockId)
  const body = parseOrThrow(stockSchema, request.body)

  return mutate(
    deps,
    request,
    reply,
    `${FUNDS_ROUTE}/:fundId/stocks/:stockId`,
    "PATCH",
    { fundId, stockId, stockName: body.stockName },
    principal.userId,
    async (tx) => {
      const existing = await deps.catalogRepository.findStock(tx, fundId, stockId)
      if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
      const stock = await deps.catalogRepository.updateStock(tx, fundId, stockId, {
        stockName: body.stockName,
        quarterLabel: body.quarterLabel,
        weightPercent: body.weightPercent === null || body.weightPercent === undefined
          ? null
          : String(body.weightPercent),
        sortOrder: body.sortOrder,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund.stock_updated",
        entityType: "fund_stock_disclosure",
        entityId: stockId,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: { fundId, stockName: stock.stockName, quarterLabel: stock.quarterLabel },
      })
      return {
        status: 200,
        body: {
          stock: {
            ...stock,
            exitedAt: isoOrNull(stock.exitedAt),
            createdAt: iso(stock.createdAt),
            updatedAt: iso(stock.updatedAt),
          },
        },
      }
    },
  )
}

const exitStock = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.write"])
  const fundId = fundIdOf(request)
  const stockId = parseOrThrow(uuidParam, (request.params as { stockId?: unknown }).stockId)
  const now = deps.clock()

  return mutate(
    deps,
    request,
    reply,
    `${FUNDS_ROUTE}/:fundId/stocks/:stockId`,
    "DELETE",
    { fundId, stockId },
    principal.userId,
    async (tx) => {
      const existing = await deps.catalogRepository.findStock(tx, fundId, stockId)
      if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
      // Exited, not deleted: the list is disclosure history.
      const stock = await deps.catalogRepository.markStockExited(tx, fundId, stockId, now)
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund.stock_exited",
        entityType: "fund_stock_disclosure",
        entityId: stockId,
        fromState: existing.state,
        toState: stock.state,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: { fundId, stockName: stock.stockName },
      })
      return { status: 200, body: { stock: { ...stock, exitedAt: isoOrNull(stock.exitedAt), createdAt: iso(stock.createdAt), updatedAt: iso(stock.updatedAt) } } }
    },
  )
}

const patchFundState = async (
  deps: AdminCatalogDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  forcedState: "archived" | null,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.write"])
  const fundId = fundIdOf(request)
  const nextState = forcedState ?? parseOrThrow(lifecycleSchema, request.body).status
  const now = deps.clock()

  return mutate(
    deps,
    request,
    reply,
    `${FUNDS_ROUTE}/:fundId`,
    forcedState === null ? "PATCH" : "DELETE",
    { fundId, status: nextState },
    principal.userId,
    async (tx) => {
      const fund = await deps.catalogRepository.lock(tx, fundId)
      if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")
      // A pool cannot be published without a version describing its terms.
      if (nextState === "published" && fund.current_published_version_id === null) {
        throw new AppError("STATE_CONFLICT")
      }
      const updated = await deps.catalogRepository.setState(tx, { fundId, state: nextState, now })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: `fund.${nextState}`,
        entityType: "fund",
        entityId: fundId,
        fromState: fund.state,
        toState: updated.state,
        requestId: request.requestId,
        entityVersion: Number(updated.version),
        metadata: { slug: updated.slug },
      })
      return { status: 200, body: { fundId, status: updated.state, version: Number(updated.version) } }
    },
  )
}

interface PoolSplitShare extends PoolMember {
  readonly name: string
  readonly gainPaise: bigint
}

interface PoolSplitSummary {
  readonly basisPaise: string
  readonly allocatedPaise: string
  readonly shares: readonly PoolSplitShare[]
}

/**
 * Turn a pool's ledger into the per-investor amounts a distribution would write.
 * Positions are derived with the same function the investor's dashboard uses, so a
 * preview and the investor's own view agree.
 */
const poolSplit = (
  rows: readonly FundInvestorLedgerRow[],
  body: Readonly<{ totalGainPaise?: number | undefined; growthBasisPoints?: number | undefined }>,
): PoolSplitSummary => {
  const grouped = new Map<string, { readonly name: string; readonly rows: FundInvestorLedgerRow[] }>()
  for (const row of rows) {
    const bucket = grouped.get(row.userId)
    if (bucket === undefined) grouped.set(row.userId, { name: row.investorName, rows: [row] })
    else bucket.rows.push(row)
  }

  const members = [...grouped.entries()].map(([userId, bucket]) => ({
    userId,
    name: bucket.name,
    currentValuePaise: derivePortfolio(toLedgerEntries(bucket.rows)).currentValuePaise,
  }))

  const split =
    body.growthBasisPoints === undefined
      ? splitPoolGainByAmount(members, BigInt(body.totalGainPaise ?? 0))
      : splitPoolGainByPercent(members, body.growthBasisPoints)

  const nameOf = new Map(members.map((member) => [member.userId, member.name]))
  return {
    basisPaise: split.basisPaise.toString(),
    allocatedPaise: split.allocatedPaise.toString(),
    shares: split.shares.map((share) => ({
      userId: share.userId,
      name: nameOf.get(share.userId) ?? "",
      currentValuePaise: share.currentValuePaise,
      gainPaise: share.gainPaise,
    })),
  }
}

/**
 * Everyone holding money in a pool, with the position derived from the ledger.
 * This is the admin's working view for the pool: who is in it, what each investor
 * put in, what they are worth now, and what the pool totals to. The figures come
 * from the same pure derivation the investor's own dashboard uses.
 */
const listFundInvestors = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["funds.read", "finance.read"])
  const fundId = fundIdOf(request)

  const { fund, rows } = await deps.unitOfWork.execute(async (tx) => ({
    fund: await deps.catalogRepository.findOne(tx, fundId),
    rows: await deps.investorLedgerRepository.listByFundWithInvestors(tx, fundId),
  }))
  if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")

  const byInvestor = new Map<string, { readonly rows: FundInvestorLedgerRow[] }>()
  for (const row of rows) {
    const bucket = byInvestor.get(row.userId)
    if (bucket === undefined) byInvestor.set(row.userId, { rows: [row] })
    else bucket.rows.push(row)
  }

  const investors = [...byInvestor.entries()].map(([userId, bucket]) => {
    const first = bucket.rows[0] as FundInvestorLedgerRow
    const position = derivePortfolio(toLedgerEntries(bucket.rows))
    return {
      userId,
      name: first.investorName,
      email: first.investorEmail,
      accountState: first.accountState,
      totalInvestmentPaise: position.totalInvestmentPaise.toString(),
      currentValuePaise: position.currentValuePaise.toString(),
      totalReturnPaise: position.totalReturnPaise.toString(),
      returnPercent: position.returnPercent,
      allocatedGainPaise: position.allocatedGainPaise.toString(),
      redeemedTotalPaise: position.redeemedTotalPaise.toString(),
      lastEntryAt: iso((bucket.rows.at(-1) as FundInvestorLedgerRow).createdAt),
    }
  })

  // Sorted by size so the admin sees the largest positions first.
  investors.sort((left, right) =>
    BigInt(right.currentValuePaise) === BigInt(left.currentValuePaise)
      ? left.name.localeCompare(right.name)
      : BigInt(right.currentValuePaise) > BigInt(left.currentValuePaise)
        ? 1
        : -1,
  )

  const totals = investors.reduce(
    (accumulator, investor) => ({
      totalInvestmentPaise: accumulator.totalInvestmentPaise + BigInt(investor.totalInvestmentPaise),
      currentValuePaise: accumulator.currentValuePaise + BigInt(investor.currentValuePaise),
      totalReturnPaise: accumulator.totalReturnPaise + BigInt(investor.totalReturnPaise),
    }),
    { totalInvestmentPaise: 0n, currentValuePaise: 0n, totalReturnPaise: 0n },
  )

  return reply.sendData({
    fundId,
    investorCount: investors.length,
    // What investors actually hold, which is the basis any distribution uses.
    investedTotalPaise: totals.totalInvestmentPaise.toString(),
    currentValueTotalPaise: totals.currentValuePaise.toString(),
    returnTotalPaise: totals.totalReturnPaise.toString(),
    investors,
  })
}

/**
 * Allocate a period's growth across the whole pool in one action: the amount (or
 * percentage) is split by each investor's current value and written as one
 * `gain_allocation` per investor, inside a single transaction. Either every
 * investor is credited or none is.
 */
const allocatePoolGain = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["finance.operate"])
  const fundId = fundIdOf(request)
  const body = parseOrThrow(poolAllocationSchema, request.body)

  // A preview writes nothing, so it needs no idempotency key and takes no lock.
  if (body.dryRun) {
    const preview = await deps.unitOfWork.execute(async (tx) => {
      const fund = await deps.catalogRepository.findOne(tx, fundId)
      if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")
      const rows = await deps.investorLedgerRepository.listByFundWithInvestors(tx, fundId)
      return poolSplit(rows, body)
    })
    return reply.sendData({
      fundId,
      dryRun: true,
      basisPaise: preview.basisPaise,
      allocatedPaise: preview.allocatedPaise,
      // Paise cross the wire as strings; a bigint is not JSON-serialisable.
      shares: preview.shares.map((share) => ({
        userId: share.userId,
        name: share.name,
        currentValuePaise: share.currentValuePaise.toString(),
        gainPaise: share.gainPaise.toString(),
      })),
    })
  }

  return mutate(
    deps,
    request,
    reply,
    `${FUNDS_ROUTE}/:fundId/gain-allocations`,
    "POST",
    {
      fundId,
      effectiveDate: body.effectiveDate,
      totalGainPaise: body.totalGainPaise ?? null,
      growthBasisPoints: body.growthBasisPoints ?? null,
    },
    principal.userId,
    async (tx) => {
      const fund = await deps.catalogRepository.lock(tx, fundId)
      if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")

      const rows = await deps.investorLedgerRepository.listByFundWithInvestors(tx, fundId)
      const split = poolSplit(rows, body)
      if (split.shares.length === 0) throw new AppError("STATE_CONFLICT")

      const allocations: Record<string, unknown>[] = []
      for (const share of split.shares) {
        // Zero shares are skipped: an investor with no value has nothing to earn,
        // and the ledger refuses a zero-value allocation anyway.
        if (share.gainPaise === 0n) continue
        const result = await allocateGain(
          tx,
          {
            investorLedgerRepository: deps.investorLedgerRepository,
            notificationRepository: deps.notificationRepository,
            auditRepository: deps.auditRepository,
            clock: deps.clock,
          },
          {
            userId: share.userId,
            fundId,
            gainPaise: share.gainPaise,
            effectiveDate: body.effectiveDate,
            allocatedByUserId: principal.userId,
            reasonCode: body.reasonCode,
            note: body.note ?? null,
            requestId: request.requestId,
          },
        )
        allocations.push({
          userId: share.userId,
          name: share.name,
          gainPaise: share.gainPaise.toString(),
          currentValuePaise: result.currentValuePaise.toString(),
          totalInvestmentPaise: result.totalInvestmentPaise.toString(),
          returnPercent: result.returnPercent,
        })
      }

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund.pool_gain_allocated",
        entityType: "fund",
        entityId: fundId,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: {
          effectiveDate: body.effectiveDate,
          basisPaise: split.basisPaise,
          allocatedPaise: split.allocatedPaise,
          investorCount: allocations.length,
          reasonCode: body.reasonCode,
        },
      })

      return {
        status: 201,
        body: {
          fundId,
          effectiveDate: body.effectiveDate,
          basisPaise: split.basisPaise,
          allocatedPaise: split.allocatedPaise,
          investorCount: allocations.length,
          allocations,
        },
      }
    },
  )
}

export const registerAdminCatalogRoutes = (
  application: FastifyInstance,
  deps: AdminCatalogDeps,
): void => {
  application.get(FUNDS_ROUTE, async (request, reply) => listFunds(deps, request, reply))
  application.get(`${FUNDS_ROUTE}/:fundId`, async (request, reply) => getFund(deps, request, reply))
  application.post(FUNDS_ROUTE, async (request, reply) => createFund(deps, request, reply))
  application.post(`${FUNDS_ROUTE}/:fundId/versions`, async (request, reply) =>
    publishVersion(deps, request, reply),
  )
  application.post(`${FUNDS_ROUTE}/:fundId/aum-updates`, async (request, reply) =>
    publishAumUpdate(deps, request, reply),
  )
  application.get(`${FUNDS_ROUTE}/:fundId/investors`, async (request, reply) =>
    listFundInvestors(deps, request, reply),
  )
  application.post(`${FUNDS_ROUTE}/:fundId/gain-allocations`, async (request, reply) =>
    allocatePoolGain(deps, request, reply),
  )
  application.get(`${FUNDS_ROUTE}/:fundId/stocks`, async (request, reply) =>
    listStocks(deps, request, reply),
  )
  application.post(`${FUNDS_ROUTE}/:fundId/stocks`, async (request, reply) => addStock(deps, request, reply))
  application.patch(`${FUNDS_ROUTE}/:fundId/stocks/:stockId`, async (request, reply) =>
    editStock(deps, request, reply),
  )
  application.delete(`${FUNDS_ROUTE}/:fundId/stocks/:stockId`, async (request, reply) =>
    exitStock(deps, request, reply),
  )
  application.patch(`${FUNDS_ROUTE}/:fundId`, async (request, reply) =>
    patchFundState(deps, request, reply, null),
  )
  application.delete(`${FUNDS_ROUTE}/:fundId`, async (request, reply) =>
    patchFundState(deps, request, reply, "archived"),
  )
}
