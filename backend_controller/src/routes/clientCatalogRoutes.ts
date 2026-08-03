/**
 * Client fund-catalog read routes (spec 03 §4.2; spec 04 §3/§4.5). Native bearer
 * transport, same principal re-check as the rest of the `/v1/client/*` slice, so
 * a suspended or closed account cannot browse the catalogue.
 *
 *   GET /v1/client/funds             published pools, keyset-paginated
 *   GET /v1/client/funds/:fundId     one pool + its published allocation + disclosure
 *
 * Option B: a pool has no per-unit price. What an investor sees is its **Fund
 * Size (AUM)** — the latest published monthly closing figure with the date it was
 * last updated — and its **Fund Portfolio**, the administrator-curated stock list
 * tagged by the quarter each entry was added. Growth reaches the investor as an
 * administrator-allocated gain on their own ledger, not through a price here.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Database } from "../db/types.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import { computeFilterHash, decodeCursor, encodeCursor } from "../http/cursor.js"
import type { PageMeta } from "../http/envelope.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type {
  ClientCatalogRepository,
  ClientFundRow,
} from "../repositories/clientCatalogRepository.js"

export interface ClientCatalogConfig {
  readonly cursorKey: Buffer
}

export interface ClientCatalogDeps extends NativeRequestAuthDeps {
  readonly database: Kysely<Database>
  readonly clock: () => Date
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

const mapFund = (row: ClientFundRow): Record<string, unknown> => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  category: row.category,
  objective: row.objective,
  riskLevel: row.riskLevel,
  returnTier: row.returnTier,
  currency: row.currency,
  status: "published",
  minimumSipPaise: row.minimumSipPaise,
  minimumPurchasePaise: row.minimumPurchasePaise,
  minimumDurationMonths: row.minimumDurationMonths,
  recommendedHoldingMonths: row.recommendedHoldingMonths,
  version: row.currentVersion,
  // "Fund Size (AUM)" as last published, with its month and last-updated date.
  // Null until the administrator publishes the pool's first monthly update.
  fundSize:
    row.aumPaise === null
      ? null
      : {
          aumPaise: row.aumPaise,
          periodStart: row.aumPeriodStart,
          lastUpdatedAt: isoOrNull(row.aumUpdatedAt),
        },
  stockCount: row.stockCount,
  publishedAt: isoOrNull(row.publishedAt),
  createdAt: iso(row.createdAt),
})

const listFunds = async (deps: ClientCatalogDeps, request: FastifyRequest, reply: FastifyReply) => {
  await authenticateNativeRequest(request, deps)
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
  await authenticateNativeRequest(request, deps)
  const fundId = parseOrThrow(uuidParam, (request.params as { fundId?: unknown }).fundId)

  const fund = await deps.clientCatalogRepository.findPublished(deps.database, fundId)
  if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")

  const [stocks, disclosure] = await Promise.all([
    deps.clientCatalogRepository.listStocks(deps.database, fundId),
    deps.clientCatalogRepository.findDisclosure(deps.database, fundId),
  ])

  return reply.sendData(
    {
      fund: mapFund(fund),
      // Module 6: what the pool owns and when each holding entered.
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
    },
    { status: 200 },
  )
}

export const registerClientCatalogRoutes = (
  application: FastifyInstance,
  deps: ClientCatalogDeps,
): void => {
  application.get(FUNDS_ROUTE, async (request, reply) => listFunds(deps, request, reply))
  application.get(`${FUNDS_ROUTE}/:fundId`, async (request, reply) => getFund(deps, request, reply))
}
