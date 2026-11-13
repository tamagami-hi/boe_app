import { describe, expect, test } from "vitest"

import { collectPages, ExportStoppedError, type ExportPage } from "./collectPages"

const PAGES: ReadonlyMap<string, ExportPage<number>> = new Map([
  ["first", { items: [1, 2], nextCursor: "c2", hasMore: true }],
  ["c2", { items: [3, 4], nextCursor: "c3", hasMore: true }],
  ["c3", { items: [5], nextCursor: null, hasMore: false }],
])

const pageAt = (cursor: string | undefined): Promise<ExportPage<number>> => {
  const page = PAGES.get(cursor ?? "first")
  return page === undefined ? Promise.reject(new Error("unknown cursor")) : Promise.resolve(page)
}

describe("export page walk", () => {
  test("follows every cursor to the last page", async () => {
    const progress: number[] = []
    const rows = await collectPages(
      pageAt,
      (loaded) => {
        progress.push(loaded)
      },
    )
    expect(rows).toEqual([1, 2, 3, 4, 5])
    expect(progress).toEqual([2, 4, 5])
  })

  test("stops at the failed page and returns no partial rows", async () => {
    const failure = new Error("offline")
    const walk = collectPages(
      (cursor) => (cursor === "c3" ? Promise.reject(failure) : pageAt(cursor)),
      () => undefined,
    )
    await expect(walk).rejects.toBeInstanceOf(ExportStoppedError)
    await expect(walk).rejects.toMatchObject({ pageNumber: 3, reason: failure })
  })

  test("refuses a cursor that does not advance instead of looping", async () => {
    let calls = 0
    const walk = collectPages(
      () => {
        calls += 1
        return Promise.resolve({ items: [calls], nextCursor: "same", hasMore: true })
      },
      () => undefined,
    )
    await expect(walk).rejects.toMatchObject({ pageNumber: 2 })
    expect(calls).toBe(2)
  })

  test("refuses a page that claims more without a cursor", async () => {
    const walk = collectPages(() => Promise.resolve({ items: [1], nextCursor: null, hasMore: true }), () => undefined)
    await expect(walk).rejects.toMatchObject({ pageNumber: 1 })
  })
})
