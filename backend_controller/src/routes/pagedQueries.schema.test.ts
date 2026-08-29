import { describe, expect, test } from "vitest"

import {
  paymentsQuerySchema as adminPaymentsQuerySchema,
  queueQuerySchema,
  refundsQuerySchema,
} from "./adminFundReceiptRoutes.js"
import { listQuerySchema, paymentsQuerySchema } from "./clientAccountRoutes.js"
import { historyQuerySchema, transactionsQuerySchema } from "./clientPortfolioRoutes.js"
import { MAX_PAGE_LIMIT } from "../http/pagination.js"

const CURSOR = "cursorbodycursorbody.cursorsignaturecursor"

const PAGED = [
  ["client notifications and support requests", listQuerySchema],
  ["client transactions", transactionsQuerySchema],
  ["client orders", historyQuerySchema],
  ["client payments", paymentsQuerySchema],
  ["admin fund receipts", queueQuerySchema],
  ["admin refunds", refundsQuerySchema],
  ["admin payments", adminPaymentsQuerySchema],
] as const

describe("every paged list query", () => {
  test.each(PAGED)("%s pages without a cursor on the first read", (_name, schema) => {
    const parsed = schema.parse({})
    expect(parsed.after).toBeUndefined()
    expect(parsed.limit).toBe(25)
  })

  test.each(PAGED)("%s accepts an opaque cursor verbatim", (_name, schema) => {
    expect(schema.parse({ after: CURSOR }).after).toBe(CURSOR)
  })

  test.each(PAGED)("%s refuses an empty cursor rather than reading page one", (_name, schema) => {
    expect(schema.safeParse({ after: "" }).success).toBe(false)
  })

  test.each(PAGED)("%s coerces the limit and bounds it", (_name, schema) => {
    expect(schema.parse({ limit: "10" }).limit).toBe(10)
    expect(schema.parse({ limit: String(MAX_PAGE_LIMIT) }).limit).toBe(MAX_PAGE_LIMIT)
    expect(schema.safeParse({ limit: "0" }).success).toBe(false)
    expect(schema.safeParse({ limit: String(MAX_PAGE_LIMIT + 1) }).success).toBe(false)
    expect(schema.safeParse({ limit: "12.5" }).success).toBe(false)
  })

  test.each(PAGED)("%s rejects an unknown query parameter", (_name, schema) => {
    expect(schema.safeParse({ offset: "25" }).success).toBe(false)
    expect(schema.safeParse({ page: "2" }).success).toBe(false)
  })
})

describe("client payment history query", () => {
  test("carries the status filter alongside the cursor", () => {
    const parsed = paymentsQuerySchema.parse({ status: "confirmed", after: CURSOR })
    expect(parsed.status).toBe("confirmed")
    expect(parsed.after).toBe(CURSOR)
  })

  test("accepts a repeated status parameter", () => {
    expect(paymentsQuerySchema.parse({ status: ["confirmed", "processing"] }).status).toEqual([
      "confirmed",
      "processing",
    ])
  })
})

describe("admin queue filters", () => {
  test("the receipt queue defaults to pending and refuses an unknown state", () => {
    expect(queueQuerySchema.parse({}).state).toBe("pending")
    expect(queueQuerySchema.safeParse({ state: "acknowledged" }).success).toBe(true)
    expect(queueQuerySchema.safeParse({ state: "settled" }).success).toBe(false)
  })

  test("the refund queue defaults to failed and admits the all sentinel", () => {
    expect(refundsQuerySchema.parse({}).state).toBe("failed")
    expect(refundsQuerySchema.parse({ state: "all" }).state).toBe("all")
    expect(refundsQuerySchema.safeParse({ state: "cancelled" }).success).toBe(false)
  })
})
