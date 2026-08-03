/**
 * Shared plumbing for the `/v1/admin/*` route groups (spec 04 §3.2/§4.5).
 *
 * The admin identity slice grew these helpers inline; the catalog, content, and
 * oversight groups need the identical transport contract, so they live here once:
 *
 *   - authenticated opaque keyset cursors bound to route + filter hash;
 *   - `Idempotency-Key` and `If-Match` header extraction with canonical errors;
 *   - the request-hash + idempotency-scope shape for admin mutations; and
 *   - the `executeIdempotent` wrapper so a replayed mutation returns the first
 *     committed result rather than acting twice.
 *
 * Nothing here reads or writes domain state: route groups keep their own
 * repositories and commands.
 */
import { createHash } from "node:crypto"

import type { FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, IdempotencyScope, Transaction } from "../db/repositories.js"
import { computeFilterHash, decodeCursor, encodeCursor } from "../http/cursor.js"
import type { PageMeta } from "../http/envelope.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent, idempotencyKeySchema } from "../http/idempotencyProtocol.js"

/** Largest page any admin list will serve, mirroring the client read slice. */
export const MAX_ADMIN_LIMIT = 100

export const limitSchema = z.coerce.number().int().min(1).max(MAX_ADMIN_LIMIT).default(25)
export const uuidParam = z.string().uuid()
export const reasonCodeSchema = z.string().trim().min(1).max(80)
export const reasonDetailSchema = z.string().trim().min(1).max(2000)
/** Free-text search term; bounded so a query can never become a scan bomb. */
export const searchSchema = z.string().trim().min(1).max(120)
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "must be a lowercase hyphenated slug")

export const iso = (value: Date | string): string => new Date(value).toISOString()
export const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : iso(value)
/** `bigint`/`numeric` columns arrive as strings; never coerce money to a number. */
export const numberOrNull = (value: number | string | null): number | null =>
  value === null ? null : Number(value)

export const versionNumber = (value: unknown): number => Number(value)

export { computeFilterHash }

export const requireIdempotencyKey = (request: FastifyRequest): string => {
  const header = request.headers["idempotency-key"]
  const value = Array.isArray(header) ? header[0] : header
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "idempotency-key": ["a valid Idempotency-Key header is required"] },
    })
  }
  return parsed.data
}

/**
 * Optional `Idempotency-Key`: the admin console does not send one on simple
 * content edits. When absent the caller derives a deterministic key from the
 * request so a double-click still collapses into one write.
 */
export const optionalIdempotencyKey = (request: FastifyRequest): string | null => {
  const header = request.headers["idempotency-key"]
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || value === "") return null
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "idempotency-key": ["a valid Idempotency-Key header is required"] },
    })
  }
  return parsed.data
}

export const parseIfMatchVersion = (request: FastifyRequest): number => {
  const value = request.headers["if-match"]
  const match = typeof value === "string" ? /^"?(\d+)"?$/u.exec(value.trim()) : null
  const captured = match?.[1]
  if (captured === undefined) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "if-match": ["a quoted integer version is required"] },
    })
  }
  return Number(captured)
}

export const hashRequest = (canonical: Readonly<Record<string, unknown>>): Buffer =>
  createHash("sha256").update(JSON.stringify(canonical)).digest()

export interface KeysetPosition {
  readonly afterCreatedAt?: Date
  readonly afterId?: string
}

export const readKeyset = (
  cursorKey: Buffer,
  after: string | undefined,
  route: string,
  filterHash: string,
  now: Date,
): KeysetPosition => {
  if (after === undefined) return {}
  const parts = decodeCursor(cursorKey, after, { route, filterHash, now })
  const createdAtRaw = parts[0]
  const idRaw = parts[1]
  if (createdAtRaw === undefined || idRaw === undefined) throw new AppError("CURSOR_INVALID")
  return { afterCreatedAt: new Date(createdAtRaw), afterId: idRaw }
}

export interface Paginated<Row> {
  readonly items: readonly Row[]
  readonly page: PageMeta
}

/**
 * Trim the `limit + 1` probe row, and mint the next cursor from the last kept
 * row's sort values. Callers always query one extra row.
 */
export const paginate = <Row>(
  cursorKey: Buffer,
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
      ? encodeCursor(cursorKey, { route, filterHash, sortValues: sortValues(last), now })
      : null
  return { items, page: { nextCursor, limit, hasMore } }
}

export const adminIdempotencyScope = (
  userId: string,
  routeTemplate: string,
  key: string,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): IdempotencyScope => ({
  actorScope: `admin:${userId}`,
  actorScopeKeyVersion: null,
  candidateActorScopes: [`admin:${userId}`],
  method,
  routeTemplate,
  key,
})

export interface AdminMutationOptions<TBody> {
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly now: Date
  readonly idempotencyTtlMs: number
  readonly scope: IdempotencyScope
  readonly requestHash: Buffer
  readonly execute: (tx: Transaction) => Promise<{ readonly status: number; readonly body: TBody }>
}

export interface AdminMutationResult<TBody> {
  readonly status: number
  readonly body: TBody
  readonly replay: boolean
}

/** One transaction, one idempotency record, one committed outcome. */
export const runAdminMutation = async <TBody extends Record<string, unknown>>(
  options: AdminMutationOptions<TBody>,
): Promise<AdminMutationResult<TBody>> =>
  options.unitOfWork.execute((tx) =>
    executeIdempotent<TBody>({
      repository: options.idempotencyRepository,
      tx,
      scope: options.scope,
      requestHash: options.requestHash,
      now: options.now.toISOString(),
      expiresAt: new Date(options.now.getTime() + options.idempotencyTtlMs).toISOString(),
      execute: async () => options.execute(tx),
    }),
  )
