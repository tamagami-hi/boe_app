import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Database } from "../db/types.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { computeFilterHash } from "../http/cursor.js"
import { AppError } from "../http/errorCatalog.js"
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, paginate, readKeysetValues } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type {
  ClientValueUpdateRepository,
  ClientValueUpdateRow,
} from "../repositories/clientValueUpdateRepository.js"

export interface ClientValueUpdateConfig {
  readonly cursorKey: Buffer
}

export interface ClientValueUpdateDeps extends ClientRequestAuthDeps {
  readonly clientValueUpdateRepository: ClientValueUpdateRepository
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: ClientValueUpdateConfig
}

const VALUE_UPDATES_ROUTE = "/v1/client/value-updates"

export const valueUpdatesQuerySchema = z
  .object({
    after: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  })
  .strict()

const readPosition = (
  values: readonly string[],
): Readonly<{ afterCursorAt?: string; afterId?: string }> => {
  if (values.length === 0) return {}
  const [afterCursorAt, afterId] = values
  if (afterCursorAt === undefined || afterId === undefined) throw new AppError("CURSOR_INVALID")
  return { afterCursorAt, afterId }
}

const mapValueUpdate = (row: ClientValueUpdateRow): Record<string, unknown> => ({
  entryId: row.id,
  fundId: row.fundId,
  fundName: row.fundName,
  date: row.effectiveDate,
  changePaise: row.changePaise,
  valueAfterPaise: row.valueAfterPaise,
  createdAt: new Date(row.createdAt).toISOString(),
})

const listValueUpdates = async (
  deps: ClientValueUpdateDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveClientPrincipal(request, deps)
  const query = parseOrThrow(valueUpdatesQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId: principal.userId })
  const keyset = readPosition(
    readKeysetValues(deps.config.cursorKey, query.after, VALUE_UPDATES_ROUTE, filterHash, now),
  )

  const rows = await deps.clientValueUpdateRepository.listByUser(deps.database, {
    userId: principal.userId,
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    VALUE_UPDATES_ROUTE,
    filterHash,
    now,
    (row) => [row.cursorAt, row.id],
  )
  return reply.sendData({ items: items.map(mapValueUpdate) }, { status: 200, page })
}

export const registerClientValueUpdateRoutes = (
  application: FastifyInstance,
  deps: ClientValueUpdateDeps,
): void => {
  application.get(VALUE_UPDATES_ROUTE, async (request, reply) => listValueUpdates(deps, request, reply))
}
