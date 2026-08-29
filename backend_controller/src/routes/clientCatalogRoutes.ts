import { CACHE_KEYS, type Cache } from "../cache/cache.js"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Database } from "../db/types.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { computeFilterHash, decodeCursor, encodeCursor } from "../http/cursor.js"
import type { PageMeta } from "../http/envelope.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import { mapFundSize, mapFundTerms } from "./fundProjection.js"
import type {
  ClientCatalogRepository,
  ClientFundRow,
} from "../repositories/clientCatalogRepository.js"

export interface ClientCatalogConfig {
  readonly cursorKey: Buffer
  readonly catalogTtlMs: number
}

export interface ClientCatalogDeps extends ClientRequestAuthDeps {
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly cache: Cache
  readonly config: ClientCatalogConfig
  readonly clientCatalogRepository: ClientCatalogRepository
}

const FUNDS_ROUTE = "/v1/client/funds"

const listQuerySchema = z
  .object({
    after: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()

const uuidParam = z.string().uuid()

const iso = (value: Date | string): string => new Date(value).toISOString()
const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : iso(value)

const clientFundSize = (row: ClientFundRow): Record<string, unknown> | null => {
  const size = mapFundSize(row)
  return size === null
    ? null
    : { aumPaise: size.aumPaise, asOfDate: size.asOfDate, lastUpdatedAt: size.updatedAt }
}

const mapFund = (row: ClientFundRow): Record<string, unknown> => ({
  id: row.id,
  slug: row.slug,
  ...mapFundTerms(row),
  status: "published",
  minimumDurationMonths: row.minimumDurationMonths,
  recommendedHoldingMonths: row.recommendedHoldingMonths,
  version: row.currentVersion,
  fundSize: clientFundSize(row),
  stockCount: row.stockCount,
  publishedAt: isoOrNull(row.publishedAt),
  createdAt: iso(row.createdAt),
})

const listFunds = async (deps: ClientCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  await resolveClientPrincipal(request, deps)
  const query = parseOrThrow(listQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({})

  let afterCreatedAt: Date | undefined
  let afterId: string | undefined
  if (query.after !== undefined) {
    const parts = decodeCursor(deps.config.cursorKey, query.after, {
      route: FUNDS_ROUTE,
      filterHash,
      now,
    })
    const createdAtRaw = parts[0]
    const idRaw = parts[1]
    if (createdAtRaw === undefined || idRaw === undefined) throw new AppError("CURSOR_INVALID")
    afterCreatedAt = new Date(createdAtRaw)
    afterId = idRaw
  }

  const rows = await deps.clientCatalogRepository.listPublished(deps.database, {
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
            route: FUNDS_ROUTE,
            filterHash,
            sortValues: [iso(last.createdAt), last.id],
            now,
          })
        : null,
    limit: query.limit,
    hasMore,
  }

  return reply.sendData({ items: items.map(mapFund) }, { status: 200, page })
}

const getFund = async (deps: ClientCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  await resolveClientPrincipal(request, deps)
  const fundId = parseOrThrow(uuidParam, (request.params as { fundId?: unknown }).fundId)

  const body = await deps.cache.readOrLoad(
    CACHE_KEYS.fundDetail(fundId),
    deps.config.catalogTtlMs,
    async () => {
      const fund = await deps.clientCatalogRepository.findPublished(deps.database, fundId)
      if (fund === null) return null

      const [stocks, disclosure] = await Promise.all([
        deps.clientCatalogRepository.listStocks(deps.database, fundId),
        deps.clientCatalogRepository.findDisclosure(deps.database, fundId),
      ])

      return {
        fund: mapFund(fund),
        stocks,
        disclosure:
          disclosure === null
            ? null
            : {
                version: disclosure.version,
                title: disclosure.title,
                body: disclosure.body,
                effectiveFrom: iso(disclosure.effectiveFrom),
              },
      }
    },
  )

  if (body === null) throw new AppError("RESOURCE_NOT_FOUND")

  return reply.sendData(body, { status: 200 })
}

export const registerClientCatalogRoutes = (
  application: FastifyInstance,
  deps: ClientCatalogDeps,
): void => {
  application.get(FUNDS_ROUTE, async (request, reply) => listFunds(deps, request, reply))
  application.get(`${FUNDS_ROUTE}/:fundId`, async (request, reply) => getFund(deps, request, reply))
}
