import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement } from "react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it } from "vitest"

import { toCursor } from "~/api/cursor"
import type { Cursor } from "~/api/cursor"
import { clampPageLimit, mergePages, usePagedQuery } from "~/api/paged"
import type { FetchedPage } from "~/api/paged"

type Row = Readonly<{ id: string }>
type ListData = Readonly<{ items: readonly Row[]; unreadCount: number }>

const CURSOR = "cursorbodycursorbody.cursorsignaturecursor"

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
