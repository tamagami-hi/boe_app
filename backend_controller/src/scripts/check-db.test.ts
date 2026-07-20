import { describe, expect, test, vi } from "vitest"

import { checkDatabase } from "./check-db.js"

describe("checkDatabase", () => {
  test("returns ok when the trivial query succeeds", async () => {
    const result = await checkDatabase({ query: vi.fn(() => Promise.resolve(undefined)) })
    expect(result).toEqual({ ok: true })
  })

  test("returns not ok when the query fails", async () => {
    const result = await checkDatabase({ query: vi.fn(() => Promise.reject(new Error("down"))) })
    expect(result).toEqual({ ok: false })
  })
})
