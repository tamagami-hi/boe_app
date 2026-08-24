import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database, FundState } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { computeAumBasisHash } from "../domain/admin/fundAumGrowth.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AdminCatalogRepository, FundListRow } from "../repositories/adminCatalogRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { FundAumRepository } from "../repositories/fundAumRepository.js"
import { mapFundSize, mapFundTerms } from "./fundProjection.js"
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
  searchSchema,
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
  readonly aumRepository: FundAumRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

const FUNDS_ROUTE = "/v1/admin/funds"

const FUND_STATES = ["draft", "published", "paused", "archived"] as const

const ALLOWED_TRANSITIONS: Readonly<Record<FundState, readonly FundState[]>> = {
  draft: ["published", "archived"],
  published: ["paused", "archived"],
  paused: ["published", "archived"],
  archived: [],
}

const listQuerySchema = z
  .object({
    after: z.string().min(1).optional(),
    limit: limitSchema,
    state: z.enum(FUND_STATES).optional(),
    search: searchSchema.optional(),
  })
  .strict()
const paiseSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const nonNegativePaiseStringSchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,18})$/u, "must be a non-negative decimal paise string")
const shortText = z.string().trim().max(200)
const longText = z.string().trim().max(20000)
const quarterLabel = z
  .string()
  .trim()
  .regex(/^Q[1-4] FY\d{2}$/u, "must look like 'Q1 FY27'")

const versionTermsSchema = z
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

const openingAumSchema = z
  .object({
    aumPaise: nonNegativePaiseStringSchema,
    asOfDate: z.iso.date(),
    reasonCode: reasonCodeSchema,
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()

const createFundSchema = z
  .object({ slug: slugSchema, terms: versionTermsSchema, openingAum: openingAumSchema })
  .strict()

const publishVersionSchema = versionTermsSchema

const stockSchema = z
  .object({
    stockName: shortText.min(1),
    quarterLabel,
    weightPercent: z.coerce.number().min(0).max(100).nullish(),
    sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict()

const lifecycleSchema = z.object({ status: z.enum(["published", "paused", "archived"]) }).strict()

const mapFund = (row: FundListRow): Record<string, unknown> => ({
  id: row.id,
  slug: row.slug,
  status: row.state,
  ...mapFundTerms(row),
  currentVersion: row.currentVersion,
  currentVersionId: row.currentVersionId,
  aum: mapFundSize(row),
  stockCount: row.stockCount,
  publishedAt: isoOrNull(row.publishedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

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

const lockWritableFund = async (
  deps: AdminCatalogDeps,
  tx: Parameters<Parameters<UnitOfWork["execute"]>[0]>[0],
  fundId: string,
) => {
  const fund = await deps.catalogRepository.lock(tx, fundId)
  if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (fund.state === "archived") {
    throw new AppError("STATE_CONFLICT", {
      fields: { fundId: ["an archived fund cannot be modified"] },
    })
  }
  return fund
}

const listFunds = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["funds.read"])
  const query = parseOrThrow(listQuerySchema, request.query)
  const now = deps.clock()
  const filters = { state: query.state ?? null, search: query.search ?? null }
  const filterHash = computeFilterHash(filters)
  const keyset = readKeyset(deps.config.cursorKey, query.after, FUNDS_ROUTE, filterHash, now)

  const [rows, summary] = await Promise.all([
    deps.catalogRepository.list(deps.database, {
      ...keyset,
      limit: query.limit + 1,
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(query.search === undefined ? {} : { search: query.search }),
    }),
    deps.catalogRepository.countByState(deps.database),
  ])
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    FUNDS_ROUTE,
    filterHash,
    now,
    (row) => [iso(row.createdAt), row.id],
  )
  return reply.sendData({ items: items.map(mapFund), summary }, { status: 200, page })
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

interface VersionWriteInput {
  readonly fundId: string
  readonly principalUserId: string
  readonly body: z.infer<typeof versionTermsSchema>
  readonly now: Date
}

interface VersionWriteResult {
  readonly fundVersionId: string
  readonly version: number
  readonly disclosureVersionId: string
}

const writeFundVersion = async (
  deps: AdminCatalogDeps,
  tx: Parameters<Parameters<UnitOfWork["execute"]>[0]>[0],
  input: VersionWriteInput,
): Promise<VersionWriteResult> => {
  const disclosureVersion = await deps.catalogRepository.nextDisclosureVersion(tx, input.fundId)
  const disclosure = await deps.catalogRepository.insertDisclosure(tx, {
    fundId: input.fundId,
    version: disclosureVersion,
    title: input.body.disclosure.title,
    body: input.body.disclosure.body,
    contentSha256: createHash("sha256").update(input.body.disclosure.body, "utf8").digest(),
    effectiveFrom: input.now,
    publishedByUserId: input.principalUserId,
  })

  const version = await deps.catalogRepository.nextVersion(tx, input.fundId)
  const termsSha256 = createHash("sha256")
    .update(
      JSON.stringify({
        name: input.body.name,
        category: input.body.category,
        objective: input.body.objective,
        riskLevel: input.body.riskLevel,
        returnTier: input.body.returnTier ?? null,
        minimumSipPaise: input.body.minimumSipPaise,
        minimumPurchasePaise: input.body.minimumPurchasePaise,
        disclosureVersionId: disclosure.id,
      }),
      "utf8",
    )
    .digest()

  const created = await deps.catalogRepository.insertVersion(tx, {
    fundId: input.fundId,
    version,
    name: input.body.name,
    category: input.body.category,
    objective: input.body.objective,
    riskLevel: input.body.riskLevel,
    returnTier: input.body.returnTier ?? null,
    minimumSipPaise: String(input.body.minimumSipPaise),
    minimumPurchasePaise: String(input.body.minimumPurchasePaise),
    minimumDurationMonths: input.body.minimumDurationMonths ?? null,
    recommendedHoldingMonths: input.body.recommendedHoldingMonths ?? null,
    disclosureVersionId: disclosure.id,
    termsSha256,
    createdByUserId: input.principalUserId,
  })

  return { fundVersionId: created.id, version, disclosureVersionId: disclosure.id }
}

const createFund = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.write"])
  requireAnyPermission(principal, ["aum.write"])
  const body = parseOrThrow(createFundSchema, request.body)
  const now = deps.clock()

  return mutate(
    deps,
    request,
    reply,
    FUNDS_ROUTE,
    "POST",
    { slug: body.slug, terms: body.terms, openingAum: body.openingAum },
    principal.userId,
    async (tx) => {
      if (await deps.catalogRepository.slugExists(tx, body.slug)) throw new AppError("STATE_CONFLICT")
      const fund = await deps.catalogRepository.insertFund(tx, {
        slug: body.slug,
        createdByUserId: principal.userId,
      })

      const written = await writeFundVersion(deps, tx, {
        fundId: fund.id,
        principalUserId: principal.userId,
        body: body.terms,
        now,
      })
      const pointed = await deps.catalogRepository.setCurrentVersion(tx, {
        fundId: fund.id,
        versionId: written.fundVersionId,
      })

      const batch = await deps.aumRepository.insertBatch(tx, {
        scope: "individual",
        instructionType: "amount",
        effectiveDate: body.openingAum.asOfDate,
        reasonCode: body.openingAum.reasonCode,
        note: body.openingAum.note ?? null,
        basisHash: computeAumBasisHash(
          { command: "initialize", asOfDate: body.openingAum.asOfDate, aumPaise: body.openingAum.aumPaise },
          [],
        ),
        actorUserId: principal.userId,
        requestId: request.requestId,
        targetCount: 1,
        totalDeltaPaise: body.openingAum.aumPaise,
      })
      const snapshot = await deps.aumRepository.insertSnapshot(tx, {
        fundId: fund.id,
        asOfDate: body.openingAum.asOfDate,
        revision: 1,
        aumPaise: body.openingAum.aumPaise,
        growthBatchId: batch.id,
        reasonCode: body.openingAum.reasonCode,
        note: body.openingAum.note ?? null,
        publishedByUserId: principal.userId,
        requestId: request.requestId,
      })

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund.created",
        entityType: "fund",
        entityId: fund.id,
        toState: pointed.state,
        requestId: request.requestId,
        entityVersion: Number(pointed.version),
        metadata: {
          slug: fund.slug,
          fundVersionId: written.fundVersionId,
          version: written.version,
          disclosureVersionId: written.disclosureVersionId,
          openingAumPaise: body.openingAum.aumPaise,
          openingAumSnapshotId: snapshot.id,
        },
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund_aum.initialized",
        entityType: "fund_aum_snapshot",
        entityId: snapshot.id,
        toState: snapshot.aumPaise,
        requestId: request.requestId,
        entityVersion: snapshot.revision,
        metadata: {
          fundId: fund.id,
          asOfDate: snapshot.asOfDate,
          aumPaise: snapshot.aumPaise,
          reasonCode: snapshot.reasonCode,
          growthBatchId: batch.id,
          propagatedToClients: false,
        },
      })

      return {
        status: 201,
        body: {
          fund: {
            id: fund.id,
            slug: fund.slug,
            status: pointed.state,
            currentVersion: written.version,
            createdAt: iso(fund.created_at),
          },
          aum: { snapshotId: snapshot.id, aumPaise: snapshot.aumPaise, asOfDate: snapshot.asOfDate },
        },
      }
    },
  )
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
    { fundId, ...body },
    principal.userId,
    async (tx) => {
      const fund = await lockWritableFund(deps, tx, fundId)

      const written = await writeFundVersion(deps, tx, {
        fundId,
        principalUserId: principal.userId,
        body,
        now,
      })
      const published = await deps.catalogRepository.setCurrentVersion(tx, {
        fundId,
        versionId: written.fundVersionId,
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
        metadata: {
          fundVersionId: written.fundVersionId,
          version: written.version,
          disclosureVersionId: written.disclosureVersionId,
        },
      })

      return {
        status: 201,
        body: {
          fundId,
          status: published.state,
          fundVersionId: written.fundVersionId,
          version: written.version,
          disclosureVersionId: written.disclosureVersionId,
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
    { fundId, ...body },
    principal.userId,
    async (tx) => {
      await lockWritableFund(deps, tx, fundId)
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
    { fundId, stockId, ...body },
    principal.userId,
    async (tx) => {
      await lockWritableFund(deps, tx, fundId)
      const existing = await deps.catalogRepository.findStock(tx, fundId, stockId)
      if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (existing.state !== "active") {
        throw new AppError("STATE_CONFLICT", {
          fields: { stockId: ["an exited holding is a historical disclosure and cannot be edited"] },
        })
      }
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
      await lockWritableFund(deps, tx, fundId)
      const existing = await deps.catalogRepository.findStock(tx, fundId, stockId)
      if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (existing.state !== "active") {
        throw new AppError("STATE_CONFLICT", {
          fields: { stockId: ["this holding has already been marked exited"] },
        })
      }
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

const patchFundState = async (deps: AdminCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["funds.write"])
  const fundId = fundIdOf(request)
  const nextState: FundState = parseOrThrow(lifecycleSchema, request.body).status
  const now = deps.clock()

  return mutate(
    deps,
    request,
    reply,
    `${FUNDS_ROUTE}/:fundId`,
    "PATCH",
    { fundId, status: nextState },
    principal.userId,
    async (tx) => {
      const fund = await deps.catalogRepository.lock(tx, fundId)
      if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")
      if (!ALLOWED_TRANSITIONS[fund.state].includes(nextState)) throw new AppError("STATE_CONFLICT")
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
    patchFundState(deps, request, reply),
  )
}
