/**
 * Admin fund routes. Web-cookie transport, RBAC (`funds.read` to read,
 * `funds.write` to change), CSRF on unsafe methods.
 *
 *   GET    /v1/admin/funds                     pools with their current AUM + stock count
 *   GET    /v1/admin/funds/:id                 detail: versions, stock list
 *   POST   /v1/admin/funds                     create a draft pool (slug only)
 *   POST   /v1/admin/funds/:id/versions        publish a version (terms + disclosure; no price)
 *   GET    /v1/admin/funds/:id/stocks          the disclosed stock list
 *   POST   /v1/admin/funds/:id/stocks          add a stock, tagged with its quarter
 *   PATCH  /v1/admin/funds/:id/stocks/:stockId edit a stock
 *   DELETE /v1/admin/funds/:id/stocks/:stockId mark a stock exited (never deleted)
 *   PATCH  /v1/admin/funds/:id                 lifecycle: published | paused | archived
 *   DELETE /v1/admin/funds/:id                 archive
 *
 * Deliberately absent: NAV publication and unit-priced position percentages.
 * This model has no per-unit price — a pool's size is the latest published
 * `fund_aum_snapshots` row (written by the AUM instruction flow, not here) and
 * its composition is the administrator-curated stock list.
 */
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AdminCatalogRepository, FundListRow } from "../repositories/adminCatalogRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
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
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

const FUNDS_ROUTE = "/v1/admin/funds"

// --- schemas ---

const listQuerySchema = z.object({ after: z.string().min(1).optional(), limit: limitSchema }).strict()
const paiseSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const shortText = z.string().trim().max(200)
const longText = z.string().trim().max(20000)
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

const stockSchema = z
  .object({
    stockName: shortText.min(1),
    quarterLabel,
    weightPercent: z.coerce.number().min(0).max(100).nullish(),
    sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict()

const lifecycleSchema = z.object({ status: z.enum(["published", "paused", "archived"]) }).strict()

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
  // Pool size as of the latest published AUM snapshot.
  aum:
    row.aumPaise === null
      ? null
      : {
          aumPaise: row.aumPaise,
          asOfDate: row.aumAsOfDate,
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

  const [versions, stocks, disclosures] = await Promise.all([
    deps.catalogRepository.listVersions(deps.database, fundId),
    deps.catalogRepository.listStocks(deps.database, fundId),
    deps.catalogRepository.listDisclosures(deps.database, fundId),
  ])

  return reply.sendData(
    {
      fund: mapFund(fund),
      versions: versions.map((version) => ({ ...version, createdAt: iso(version.createdAt) })),
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
