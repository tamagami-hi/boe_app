declare const cursorBrand: unique symbol

export type Cursor = string & { readonly [cursorBrand]: true }

export const MAX_PAGE_LIMIT = 100
export const DEFAULT_PAGE_LIMIT = 25

export type PageMeta = Readonly<{
  nextCursor: Cursor | null
  limit: number
  hasMore: boolean
}>

export const isCursor = (value: unknown): value is Cursor =>
  typeof value === "string" && value.length > 0

export const toCursor = (value: string): Cursor => value as Cursor

export const parsePageMeta = (value: unknown): PageMeta | null => {
  if (typeof value !== "object" || value === null) return null
  const candidate = value as Record<string, unknown>
  const { nextCursor, limit, hasMore } = candidate
  if (typeof limit !== "number" || typeof hasMore !== "boolean") return null
  if (nextCursor === null) return { nextCursor: null, limit, hasMore }
  if (!isCursor(nextCursor)) return null
  return { nextCursor, limit, hasMore }
}

export const nextPageParam = (meta: PageMeta | null): Cursor | undefined => {
  if (meta === null) return undefined
  if (!meta.hasMore) return undefined
  return meta.nextCursor ?? undefined
}
