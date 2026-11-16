import { useInfiniteQuery } from "@tanstack/react-query"
import type { QueryState } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

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

type PageFetchState = Readonly<{ state: Pick<QueryState, "status" | "fetchMeta"> }>

const isAwaitingPageRetry = ({ state }: PageFetchState): boolean =>
  state.status === "error" && state.fetchMeta?.fetchMore?.direction === "forward"

const refetchUnlessAwaitingPageRetry = (query: PageFetchState): boolean => !isAwaitingPageRetry(query)

const HELD_WALK_REFETCH = {
  refetchOnMount: refetchUnlessAwaitingPageRetry,
  refetchOnWindowFocus: refetchUnlessAwaitingPageRetry,
  refetchOnReconnect: refetchUnlessAwaitingPageRetry,
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
  const query = useInfiniteQuery({
    queryKey: [...queryKey, "paged", clampPageLimit(limit)],
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

  const { error, fetchNextPage, hasNextPage, isFetchingNextPage, isError, isFetchNextPageError } = query
  const isWalkStopped = loadAll && hasNextPage && isError
  const isPageFailure = isFetchNextPageError && !isFetchingNextPage
  const [failedPageError, setFailedPageError] = useState<unknown>(null)
  const loadMoreError = error !== null && (isPageFailure || error === failedPageError) ? error : null

  useEffect(() => {
    if (isPageFailure) setFailedPageError(error)
  }, [isPageFailure, error])

  useEffect(() => {
    if (!loadAll || !hasNextPage || isFetchingNextPage || isError) return
    void fetchNextPage()
  }, [loadAll, hasNextPage, isFetchingNextPage, isError, fetchNextPage])

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
      void query.refetch()
    },
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    loadedCount: data?.items.length ?? 0,
    loadMoreError,
    loadMore: () => {
      void fetchNextPage()
    },
  }
}
