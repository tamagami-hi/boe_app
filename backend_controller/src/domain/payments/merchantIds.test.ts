import { describe, expect, test } from "vitest"

import {
  isValidMerchantReference,
  newMerchantOrderId,
  newMerchantRefundId,
} from "./merchantIds.js"

describe("merchantIds (spec §5.2/§5.3/§7)", () => {
  test("merchant order ids satisfy the provider contract and the DB CHECK", () => {
    const id = newMerchantOrderId()
    expect(isValidMerchantReference(id)).toBe(true)
    expect(id.length).toBeLessThanOrEqual(63)
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/u)
  })

  test("generated ids are unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newMerchantOrderId()))
    expect(ids.size).toBe(200)
  })

  test("merchant refund ids satisfy the same contract with a distinct prefix", () => {
    const id = newMerchantRefundId()
    expect(isValidMerchantReference(id)).toBe(true)
    expect(id).not.toBe(newMerchantOrderId())
    expect(id.startsWith("boerf_")).toBe(true)
  })

  test("the validator rejects spaces, unicode, overlong and empty ids", () => {
    expect(isValidMerchantReference("")).toBe(false)
    expect(isValidMerchantReference("has space")).toBe(false)
    expect(isValidMerchantReference("unicode-✕")).toBe(false)
    expect(isValidMerchantReference("x".repeat(64))).toBe(false)
    expect(isValidMerchantReference("ok_id-123")).toBe(true)
  })
})
