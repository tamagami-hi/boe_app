import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { toCursor } from "~/api/cursor"
import type { Cursor } from "~/api/cursor"
import { usePagedQuery } from "~/api/paged"
import type { FetchedPage } from "~/api/paged"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"

type Row = Readonly<{ id: string }>
type ListData = Readonly<{ items: readonly Row[] }>
type FetchPage = (cursor: Cursor | undefined) => Promise<FetchedPage<ListData>>

const CURSOR = "cursorbodycursorbody.cursorsignaturecursor"

const pageFor = (cursor: Cursor | undefined): FetchedPage<ListData> => {
  const isFirst = cursor === undefined
  return {
    data: { items: [{ id: isFirst ? "row-1" : "row-2" }] },
    meta: {
      requestId: null,
      timestamp: null,
      idempotencyReplay: false,
      page: { nextCursor: isFirst ? toCursor(CURSOR) : null, limit: 1, hasMore: isFirst },
    },
  }
}

const PagedRows = ({ fetchPage }: Readonly<{ fetchPage: FetchPage }>): React.ReactElement => {
  const list = usePagedQuery<ListData>({ queryKey: ["probe", "rows"], limit: 1, fetchPage })
  return (
    <>
      <AsyncBoundary query={list} skeleton={<p>Loading</p>}>
        {(data) => (
          <ul>
            {data.items.map((row) => (
              <li key={row.id}>{row.id}</li>
            ))}
          </ul>
        )}
      </AsyncBoundary>
      <LoadMore list={list} noun="rows" />
    </>
  )
}

const shownRows = (): readonly (string | null)[] =>
  screen.getAllByRole("listitem").map((item) => item.textContent)

describe("LoadMore", () => {
  it("shows a failed page as an error with Try again, not as a shorter list", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    let isPageTwoFailing = true
    const fetchPage: FetchPage = (cursor) =>
      cursor !== undefined && isPageTwoFailing
        ? Promise.reject(new Error("page two failed"))
        : Promise.resolve(pageFor(cursor))
    render(
      <QueryClientProvider client={client}>
        <PagedRows fetchPage={fetchPage} />
      </QueryClientProvider>,
    )

    const showMore = await screen.findByRole("button", { name: "Show more" })
    fireEvent.click(showMore)
    const failure = await screen.findByRole("alert")

    expect(failure).toHaveTextContent("More rows could not be loaded, so this list is not complete.")
    expect(shownRows()).toEqual(["row-1"])
    expect(screen.queryByRole("status")).toBeNull()
    expect(showMore).toHaveAccessibleName("Try again")

    isPageTwoFailing = false
    fireEvent.click(showMore)
    await waitFor(() => {
      expect(shownRows()).toEqual(["row-1", "row-2"])
    })
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
