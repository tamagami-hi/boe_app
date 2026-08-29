import { randomBytes } from "node:crypto"

import { describe, expect, test } from "vitest"

import { computeFilterHash } from "./cursor.js"
import { AppError } from "./errorCatalog.js"
import { createdAtKeyset, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, paginate, readKeyset, readKeysetValues } from "./pagination.js"

const KEY = randomBytes(32)
const ROUTE = "/v1/admin/refunds"
const NOW = new Date("2026-08-28T10:00:00.000Z")
const FILTER = computeFilterHash({ state: "failed" })

interface Row {
  readonly id: string
  readonly createdAt: Date
}

const rows = (count: number): readonly Row[] =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `0000000${String(index)}-1111-4111-8111-111111111111`,
    createdAt: new Date(NOW.getTime() - index * 1_000),
  }))

const keyset = createdAtKeyset<Row>((row) => row.createdAt)

const codeOf = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    return error instanceof AppError ? error.code : "NOT_AN_APP_ERROR"
  }
  return "NO_ERROR"
}

describe("page limits", () => {
  test("the ceiling and default are the ones the contract publishes", () => {
    expect(MAX_PAGE_LIMIT).toBe(100)
    expect(DEFAULT_PAGE_LIMIT).toBe(25)
  })
})

describe("paginate", () => {
  test("keeps the page, drops the over-fetched row, and mints a cursor", () => {
    const result = paginate(KEY, rows(4), 3, ROUTE, FILTER, NOW, keyset)

    expect(result.items).toHaveLength(3)
    expect(result.page.hasMore).toBe(true)
    expect(result.page.limit).toBe(3)
    expect(result.page.nextCursor).not.toBeNull()
  })

  test("reports the last page when the over-fetch found nothing", () => {
    const result = paginate(KEY, rows(3), 3, ROUTE, FILTER, NOW, keyset)

    expect(result.items).toHaveLength(3)
    expect(result.page.hasMore).toBe(false)
    expect(result.page.nextCursor).toBeNull()
  })

  test("an empty result is a last page, not a cursor to nowhere", () => {
    const result = paginate(KEY, [], 25, ROUTE, FILTER, NOW, keyset)

    expect(result.items).toEqual([])
    expect(result.page).toEqual({ nextCursor: null, limit: 25, hasMore: false })
  })

  test("the cursor points at the last kept row, not the over-fetched one", () => {
    const page = rows(4)
    const result = paginate(KEY, page, 3, ROUTE, FILTER, NOW, keyset)
    const position = readKeyset(KEY, result.page.nextCursor ?? undefined, ROUTE, FILTER, NOW)

    expect(position.afterId).toBe(page[2]?.id)
    expect(position.afterCreatedAt?.toISOString()).toBe(page[2]?.createdAt.toISOString())
  })
})

describe("readKeyset", () => {
  test("the first page has no position", () => {
    expect(readKeyset(KEY, undefined, ROUTE, FILTER, NOW)).toEqual({})
    expect(readKeysetValues(KEY, undefined, ROUTE, FILTER, NOW)).toEqual([])
  })

  test("refuses a cursor minted for another route", () => {
    const cursor = paginate(KEY, rows(2), 1, ROUTE, FILTER, NOW, keyset).page.nextCursor
    expect(codeOf(() => readKeyset(KEY, cursor ?? undefined, "/v1/admin/payments", FILTER, NOW)))
      .toBe("CURSOR_INVALID")
  })

  test("refuses a cursor minted under different filters", () => {
    const cursor = paginate(KEY, rows(2), 1, ROUTE, FILTER, NOW, keyset).page.nextCursor
    const otherFilter = computeFilterHash({ state: "refunded" })
    expect(codeOf(() => readKeyset(KEY, cursor ?? undefined, ROUTE, otherFilter, NOW)))
      .toBe("CURSOR_INVALID")
  })

  test("refuses a cursor signed with another key", () => {
    const cursor = paginate(KEY, rows(2), 1, ROUTE, FILTER, NOW, keyset).page.nextCursor
    expect(codeOf(() => readKeyset(randomBytes(32), cursor ?? undefined, ROUTE, FILTER, NOW)))
      .toBe("CURSOR_INVALID")
  })

  test("refuses a cursor that carries no position", () => {
    const cursor = paginate(KEY, rows(2), 1, ROUTE, FILTER, NOW, () => []).page.nextCursor
    expect(codeOf(() => readKeyset(KEY, cursor ?? undefined, ROUTE, FILTER, NOW)))
      .toBe("CURSOR_INVALID")
  })
})

describe("createdAtKeyset", () => {
  test("projects the timestamp and id pair the cursor round-trips on", () => {
    expect(keyset({ id: "abc", createdAt: NOW })).toEqual([NOW.toISOString(), "abc"])
  })
})
