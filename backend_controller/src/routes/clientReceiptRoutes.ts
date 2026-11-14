import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Database } from "../db/types.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { RECORDING_CATEGORY_TEXT, recordingCategoryOf } from "../domain/shared/recordingCategory.js"
import { computeFilterHash } from "../http/cursor.js"
import { AppError } from "../http/errorCatalog.js"
import { MAX_PAGE_LIMIT, paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { ClientReceiptRepository, ClientReceiptRow } from "../repositories/clientReceiptRepository.js"

export interface ClientReceiptConfig {
  readonly cursorKey: Buffer
}

export interface ClientReceiptDeps extends ClientRequestAuthDeps {
  readonly clientReceiptRepository: ClientReceiptRepository
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: ClientReceiptConfig
}

const RECEIPTS_ROUTE = "/v1/client/receipts"
const RECEIPT_ROUTE = "/v1/client/receipts/:entryId"

const receiptsQuerySchema = z
  .object({
    after: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(25),
    fundId: z.string().uuid().optional(),
  })
  .strict()

const entryIdSchema = z.string().uuid()

const iso = (value: Date | string): string => new Date(value).toISOString()

const mapReceipt = (row: ClientReceiptRow): Record<string, unknown> => {
  const category = recordingCategoryOf(row.reasonCode)
  return {
    entryId: row.entryId,
    orderId: row.orderId,
    fundId: row.fundId,
    fundName: row.fundName,
    category,
    categoryLabel: RECORDING_CATEGORY_TEXT[category].label,
    amountPaise: row.amountPaise,
    effectiveDate: row.effectiveDate,
    recordedAt: iso(row.recordedAt),
    reversedAt: row.reversedAt === null ? null : iso(row.reversedAt),
    sipMonth: row.sipMonth,
  }
}

const listReceipts = async (deps: ClientReceiptDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const query = parseOrThrow(receiptsQuerySchema, request.query)
  const now = deps.clock()
  const filters = query.fundId === undefined ? { userId: principal.userId } : { userId: principal.userId, fundId: query.fundId }
  const filterHash = computeFilterHash(filters)
  const keyset = readKeyset(deps.config.cursorKey, query.after, RECEIPTS_ROUTE, filterHash, now)

  const rows = await deps.clientReceiptRepository.listByUser(deps.database, {
    ...filters,
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    RECEIPTS_ROUTE,
    filterHash,
    now,
    (row) => [row.cursorAt, row.entryId],
  )
  return reply.sendData({ items: items.map(mapReceipt) }, { status: 200, page })
}

const getReceipt = async (deps: ClientReceiptDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const entryId = parseOrThrow(entryIdSchema, (request.params as { entryId?: unknown }).entryId)
  const row = await deps.clientReceiptRepository.findByUser(deps.database, {
    userId: principal.userId,
    entryId,
  })
  if (row === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData({ receipt: mapReceipt(row) }, { status: 200 })
}

export const registerClientReceiptRoutes = (application: FastifyInstance, deps: ClientReceiptDeps): void => {
  application.get(RECEIPTS_ROUTE, async (request, reply) => listReceipts(deps, request, reply))
  application.get(RECEIPT_ROUTE, async (request, reply) => getReceipt(deps, request, reply))
}
