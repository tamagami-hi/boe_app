import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement } from "react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { toCursor } from "~/api/cursor"
import type { Cursor } from "~/api/cursor"
import { clampPageLimit, mergePages, usePagedQuery } from "~/api/paged"
import type { FetchedPage } from "~/api/paged"

type Row = Readonly<{ id: string }>
type ListData = Readonly<{ items: readonly Row[]; unreadCount: number }>

const CURSOR = "cursorbodycursorbody.cursorsignaturecursor"
const FAILURE_DELAY_MS = 5
const SETTLE_MS = 100

const requested: { filter: string; cursor: Cursor | undefined }[] = []

const pageFor = (filter: string, cursor: Cursor | undefined): FetchedPage<ListData> => {
  const isFirst = cursor === undefined
  return {
    data: {
      items: isFirst ? [{ id: `${filter}-1` }] : [{ id: `${filter}-2` }],
      unreadCount: 7,
    },
    meta: {
      requestId: null,
      timestamp: null,
      idempotencyReplay: false,
      page: {
        nextCursor: isFirst ? toCursor(CURSOR) : null,
        limit: 1,
        hasMore: isFirst,
      },
    },
  }
}

const wrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: Readonly<{ children: ReactNode }>): React.ReactElement =>
    createElement(QueryClientProvider, { client }, children)
  return Wrapper
}

const renderPaged = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return renderHook(
    ({ filter }: Readonly<{ filter: string }>) =>
      usePagedQuery<ListData>({
        queryKey: ["probe", filter],
        limit: 1,
        fetchPage: (cursor) => {
          requested.push({ filter, cursor })
          return Promise.resolve(pageFor(filter, cursor))
        },
      }),
    { initialProps: { filter: "a" }, wrapper: wrapper(client) },
  )
}

beforeEach(() => {
  requested.length = 0
})

afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

describe("usePagedQuery", () => {
  it("reads the first page without a cursor", async () => {
    const { result } = renderPaged()
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    expect(requested).toEqual([{ filter: "a", cursor: undefined }])
    expect(result.current.data?.items).toEqual([{ id: "a-1" }])
    expect(result.current.hasMore).toBe(true)
    expect(result.current.loadedCount).toBe(1)
  })

  it("appends the next page and stops when the server says there is no more", async () => {
    const { result } = renderPaged()
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => {
      expect(result.current.hasMore).toBe(false)
    })

    expect(requested[1]).toEqual({ filter: "a", cursor: CURSOR })
    expect(result.current.data?.items).toEqual([{ id: "a-1" }, { id: "a-2" }])
  })

  it("restarts pagination from the first page when a filter changes", async () => {
    const { result, rerender } = renderPaged()
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => {
      expect(result.current.loadedCount).toBe(2)
    })

    rerender({ filter: "b" })
    await waitFor(() => {
      expect(result.current.data?.items).toEqual([{ id: "b-1" }])
    })

    const underNewFilter = requested.filter((entry) => entry.filter === "b")
    expect(underNewFilter).toEqual([{ filter: "b", cursor: undefined }])
    expect(result.current.hasMore).toBe(true)
    expect(result.current.loadedCount).toBe(1)
  })

  it("stops a load-all walk on a failed page and resumes it only on retry", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const failure = new Error("page two failed")
    let isPageTwoFailing = true
    const { result } = renderHook(
      () =>
        usePagedQuery<ListData>({
          queryKey: ["probe", "walk"],
          limit: 1,
          loadAll: true,
          fetchPage: (cursor) => {
            requested.push({ filter: "walk", cursor })
            if (cursor === undefined || !isPageTwoFailing) return Promise.resolve(pageFor("walk", cursor))
            return new Promise<never>((_resolve, reject) => {
              setTimeout(() => {
                reject(failure)
              }, FAILURE_DELAY_MS)
            })
          },
        }),
      { wrapper: wrapper(client) },
    )

    await waitFor(() => {
      expect(result.current.error).toBe(failure)
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)))

    expect(requested).toEqual([
      { filter: "walk", cursor: undefined },
      { filter: "walk", cursor: CURSOR },
    ])
    expect(result.current.data).toBeUndefined()

    isPageTwoFailing = false
    act(() => {
      result.current.refetch()
    })
    await waitFor(() => {
      expect(result.current.data?.items).toEqual([{ id: "walk-1" }, { id: "walk-2" }])
    })
    expect(result.current.error).toBeNull()
    expect(requested).toHaveLength(4)
  })

  it("does not re-request a failed page on focus, reconnect or another screen opening it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const failure = new Error("page two failed")
    let isPageTwoFailing = true
    const useWalk = () =>
      usePagedQuery<ListData>({
        queryKey: ["probe", "held"],
        limit: 1,
        loadAll: true,
        fetchPage: (cursor) => {
          requested.push({ filter: "held", cursor })
          if (cursor === undefined || !isPageTwoFailing) return Promise.resolve(pageFor("held", cursor))
          return Promise.reject(failure)
        },
      })
    const { result } = renderHook(useWalk, { wrapper: wrapper(client) })
    await waitFor(() => {
      expect(result.current.error).toBe(failure)
    })

    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
    })
    renderHook(useWalk, { wrapper: wrapper(client) })
    await act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)))

    expect(requested.filter((entry) => entry.filter === "held")).toEqual([
      { filter: "held", cursor: undefined },
      { filter: "held", cursor: CURSOR },
    ])
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBe(failure)

    isPageTwoFailing = false
    act(() => {
      result.current.refetch()
    })
    await waitFor(() => {
      expect(result.current.data?.items).toEqual([{ id: "held-1" }, { id: "held-2" }])
    })
    client.clear()
  })

  it("does not re-request a failed page after another hook sharing the query refreshes it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const failure = new Error("page two failed")
    let isPageTwoFailing = true
    const fetchPage = (cursor: Cursor | undefined): Promise<FetchedPage<ListData>> => {
      requested.push({ filter: "shared", cursor })
      if (cursor === undefined || !isPageTwoFailing) return Promise.resolve(pageFor("shared", cursor))
      return Promise.reject(failure)
    }
    const shared = { queryKey: ["probe", "shared"], limit: 1, staleTime: 0, fetchPage } as const
    const useCatalogue = () => usePagedQuery<ListData>({ ...shared, loadAll: true })
    const useList = () => usePagedQuery<ListData>(shared)
    const sharedRequests = (isNextPage: boolean) =>
      requested.filter((entry) => entry.filter === "shared" && (entry.cursor !== undefined) === isNextPage)

    const catalogue = renderHook(useCatalogue, { wrapper: wrapper(client) })
    await waitFor(() => {
      expect(catalogue.result.current.error).toBe(failure)
    })
    catalogue.unmount()

    const list = renderHook(useList, { wrapper: wrapper(client) })
    await waitFor(() => {
      expect(list.result.current.error).toBeNull()
    })
    const listLoadMoreError = list.result.current.loadMoreError
    list.unmount()
    expect(sharedRequests(false)).toHaveLength(2)

    const returned = renderHook(useCatalogue, { wrapper: wrapper(client) })
    await act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)))

    expect(sharedRequests(true)).toHaveLength(1)
    expect(returned.result.current.data).toBeUndefined()
    expect(returned.result.current.error).toBe(failure)
    expect(listLoadMoreError).toBe(failure)

    isPageTwoFailing = false
    act(() => {
      returned.result.current.refetch()
    })
    await waitFor(() => {
      expect(returned.result.current.data?.items).toEqual([{ id: "shared-1" }, { id: "shared-2" }])
    })
    expect(sharedRequests(true)).toHaveLength(2)
    client.clear()
  })

  it("keeps a page's sibling fields from the first page while concatenating items", () => {
    const merged = mergePages<ListData>([
      { data: { items: [{ id: "1" }], unreadCount: 7 }, page: null },
      { data: { items: [{ id: "2" }], unreadCount: 0 }, page: null },
    ])

    expect(merged).toEqual({ items: [{ id: "1" }, { id: "2" }], unreadCount: 7 })
  })

  it("merges nothing when no page has been read", () => {
    expect(mergePages<ListData>([])).toBeUndefined()
  })
})

describe("clampPageLimit", () => {
  it("holds the limit inside what a cursor can describe", () => {
    expect(clampPageLimit(25)).toBe(25)
    expect(clampPageLimit(0)).toBe(1)
    expect(clampPageLimit(-5)).toBe(1)
    expect(clampPageLimit(1_000)).toBe(100)
    expect(clampPageLimit(25.7)).toBe(25)
  })
})
