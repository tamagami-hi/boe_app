import { hashKey, useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import type { QueryState } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, nextPageParam } from "~/api/cursor"
import type { Cursor, PageMeta } from "~/api/cursor"
import type { ResponseMeta } from "~/api/envelope"

export type ItemsPage = Readonly<{ items: readonly unknown[] }>

export type FetchedPage<TData> = Readonly<{ data: TData; meta: ResponseMeta }>

export type PagedListState = Readonly<{
  hasMore: boolean
  isLoadingMore: boolean
  loadedCount: number
  loadMoreError: unknown
  loadMore: () => void
}>

export type PagedQuery<TData> = PagedListState &
  Readonly<{
    data: TData | undefined
    isPending: boolean
    isFetching: boolean
    error: unknown
    refetch: () => void
  }>

export type PagedQueryInput<TData extends ItemsPage> = Readonly<{
  /**
   * Must carry every active filter. A cursor is minted against one filter set
   * and the backend refuses it under another, so a filter change has to land on
   * a different key and start from the first page.
   */
  queryKey: readonly unknown[]
  fetchPage: (cursor: Cursor | undefined) => Promise<FetchedPage<TData>>
  limit?: number
  staleTime?: number
  enabled?: boolean
  retry?: boolean
  /**
   * Walk to the end of the cursor chain instead of waiting for a Load more.
   * For a lookup table or a picker the whole set is the answer, so stopping at
   * the first page would quietly resolve later entries to nothing.
   */
  loadAll?: boolean
}>

type StoredPage<TData> = Readonly<{ data: TData; page: PageMeta | null }>

type HeldQuery = Readonly<{ state: Pick<QueryState, "status" | "fetchStatus" | "fetchMeta" | "error"> }>

type PageHold = Readonly<{ error: unknown }>

const pageHolds = new WeakMap<HeldQuery, PageHold>()
const pageHoldListeners = new Set<() => void>()

const subscribePageHolds = (listener: () => void): (() => void) => {
  pageHoldListeners.add(listener)
  return () => {
    pageHoldListeners.delete(listener)
  }
}

const notifyPageHolds = (): void => {
  for (const listener of pageHoldListeners) listener()
}

const holdPage = (query: HeldQuery, error: unknown): void => {
  if (pageHolds.get(query)?.error === error) return
  pageHolds.set(query, { error })
  notifyPageHolds()
}

const releasePage = (query: HeldQuery | undefined): void => {
  if (query === undefined || !pageHolds.delete(query)) return
  notifyPageHolds()
}

const holdOf = (query: HeldQuery | undefined): PageHold | undefined =>
  query === undefined ? undefined : pageHolds.get(query)

const settleNextPage = (query: HeldQuery): void => {
  const { state } = query
  if (state.fetchStatus !== "idle") return
  if (state.status === "success") releasePage(query)
  else if (state.fetchMeta?.fetchMore?.direction === "forward") holdPage(query, state.error)
}

const refetchUnlessHeld = (query: HeldQuery): boolean => !pageHolds.has(query)

const HELD_WALK_REFETCH = {
  refetchOnMount: refetchUnlessHeld,
  refetchOnWindowFocus: refetchUnlessHeld,
  refetchOnReconnect: refetchUnlessHeld,
} as const

export const clampPageLimit = (limit: number): number =>
  Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_LIMIT)

/**
 * Folds the loaded pages into one value shaped like a single response. Fields
 * beside `items` describe the whole result set rather than the page, so the
 * first page's copy is the authoritative one.
 */
export const mergePages = <TData extends ItemsPage>(
  pages: readonly StoredPage<TData>[],
): TData | undefined => {
  const first = pages[0]
  if (first === undefined) return undefined
  const items = pages.flatMap((page) => [...page.data.items])
  return { ...first.data, items }
}

export const usePagedQuery = <TData extends ItemsPage>({
  queryKey,
  fetchPage,
  limit = DEFAULT_PAGE_LIMIT,
  staleTime,
  enabled,
  retry,
  loadAll = false,
}: PagedQueryInput<TData>): PagedQuery<TData> => {
  const client = useQueryClient()
  const pagedKey = [...queryKey, "paged", clampPageLimit(limit)]
  const query = useInfiniteQuery({
    queryKey: pagedKey,
    initialPageParam: undefined as Cursor | undefined,
    getNextPageParam: (lastPage: StoredPage<TData>) => nextPageParam(lastPage.page),
    ...(staleTime === undefined ? {} : { staleTime }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(retry === undefined ? {} : { retry }),
    ...(loadAll ? HELD_WALK_REFETCH : {}),
    queryFn: async ({ pageParam }): Promise<StoredPage<TData>> => {
      const result = await fetchPage(pageParam)
      return { data: result.data, page: result.meta.page }
    },
  })

  const queryHash = hashKey(pagedKey)
  const hold = useSyncExternalStore(subscribePageHolds, () =>
    holdOf(client.getQueryCache().get(queryHash)),
  )
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isError, isFetchNextPageError } = query
  const isHeld = hold !== undefined
  const isWalkStopped = loadAll && hasNextPage && (isError || isHeld)
  const isPageFailure = isFetchNextPageError && !isFetchingNextPage
  const loadMoreError = isPageFailure ? query.error : (hold?.error ?? null)
  const error = query.error ?? (isWalkStopped ? (hold?.error ?? null) : null)

  const readNextPage = useCallback((): void => {
    const target = client.getQueryCache().get(queryHash)
    void fetchNextPage().then(() => {
      if (target !== undefined) settleNextPage(target)
    })
  }, [client, queryHash, fetchNextPage])

  useEffect(() => {
    if (!isHeld || hasNextPage) return
    releasePage(client.getQueryCache().get(queryHash))
  }, [isHeld, hasNextPage, client, queryHash])

  useEffect(() => {
    if (!loadAll || !hasNextPage || isFetchingNextPage || isError || isHeld) return
    readNextPage()
  }, [loadAll, hasNextPage, isFetchingNextPage, isError, isHeld, readNextPage])

  const data = useMemo(
    () => (query.data === undefined || isWalkStopped ? undefined : mergePages(query.data.pages)),
    [query.data, isWalkStopped],
  )

  return {
    data,
    isPending: query.isPending,
    isFetching: query.isFetching,
    error,
    refetch: () => {
      releasePage(client.getQueryCache().get(queryHash))
      void query.refetch()
    },
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    loadedCount: data?.items.length ?? 0,
    loadMoreError,
    loadMore: readNextPage,
  }
}
