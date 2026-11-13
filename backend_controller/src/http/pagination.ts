/**
 * Keyset pagination over the authenticated opaque cursor (spec 04 §3.2). One
 * implementation for every list route, client and admin alike: `readKeyset`
 * turns an `after` token back into a `(created_at, id)` position, and
 * `paginate` over-fetches `limit + 1` rows, keeps `limit`, and mints the next
 * cursor from the last kept row.
 *
 * A cursor is bound to its route and to a hash of the active filters, so it
 * cannot be replayed against another route or another filter set — a filter
 * change must restart pagination from the first page.
 */
import { decodeCursor, encodeCursor } from "./cursor.js"
import type { PageMeta } from "./envelope.js"
import { AppError } from "./errorCatalog.js"

export const MAX_PAGE_LIMIT = 100
export const DEFAULT_PAGE_LIMIT = 25

export interface KeysetPosition {
  readonly afterCreatedAt?: string
  readonly afterId?: string
}

const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/u
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** The raw sort values a cursor carries, or an empty tuple on the first page. */
export const readKeysetValues = (
  cursorKey: Buffer,
  after: string | undefined,
  route: string,
  filterHash: string,
  now: Date,
): readonly string[] => {
  if (after === undefined) return []
  return decodeCursor(cursorKey, after, { route, filterHash, now })
}

/** The `(created_at, id)` position a cursor encodes, or `{}` on the first page. */
export const readKeyset = (
  cursorKey: Buffer,
  after: string | undefined,
  route: string,
  filterHash: string,
  now: Date,
): KeysetPosition => {
  if (after === undefined) return {}
  const [createdAtRaw, idRaw] = decodeCursor(cursorKey, after, { route, filterHash, now })
  if (createdAtRaw === undefined || idRaw === undefined || !CURSOR_TIME.test(createdAtRaw) || !CURSOR_ID.test(idRaw)) {
    throw new AppError("CURSOR_INVALID")
  }
  return { afterCreatedAt: createdAtRaw, afterId: idRaw }
}

export interface Paginated<Row> {
  readonly items: readonly Row[]
  readonly page: PageMeta
}

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

/**
 * Cursors carry a timestamp and an id, so any list they page over must order by
 * exactly that pair. Keeping the projection here means a route cannot pick a
 * different tuple for the cursor than the one its SQL sorts on.
 */
export const createdAtKeyset = (row: Readonly<{ id: string; cursorAt: string }>): readonly string[] => [
  row.cursorAt,
  row.id,
]
