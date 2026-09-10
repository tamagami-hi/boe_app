import { describe, expect, test } from "vitest"

import {
  isValidMerchantReference,
  newMerchantOrderId,
  newMerchantRefundId,
  newMerchantSubscriptionId,
} from "./merchantIds.js"

describe("merchantIds (spec §5.2/§5.3/§7)", () => {
  test("merchant order ids satisfy the provider contract and the DB CHECK", () => {
    const id = newMerchantOrderId("boe-dev")
    expect(isValidMerchantReference(id)).toBe(true)
    expect(id.length).toBeLessThanOrEqual(63)
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/u)
  })

  test("generated ids are unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newMerchantOrderId("boe-dev")))
    expect(ids.size).toBe(200)
  })

  test("merchant refund ids satisfy the same contract with a distinct prefix", () => {
    const id = newMerchantRefundId("boe-dev")
    expect(isValidMerchantReference(id)).toBe(true)
    expect(id).not.toBe(newMerchantOrderId("boe-dev"))
    expect(id.startsWith("boe-dev_refund_")).toBe(true)
  })

  test.each(["boe-dev", "boe-prod"])("all reference kinds identify their originating service %s", (service) => {
    expect(newMerchantOrderId(service)).toMatch(new RegExp(`^${service}_order_[a-f0-9]{32}$`, "u"))
    expect(newMerchantSubscriptionId(service)).toMatch(new RegExp(`^${service}_subscription_[a-f0-9]{32}$`, "u"))
    expect(newMerchantRefundId(service)).toMatch(new RegExp(`^${service}_refund_[a-f0-9]{32}$`, "u"))
    expect(newMerchantSubscriptionId(service).length).toBeLessThanOrEqual(63)
  })

  test.each([null, "", "boe", "boe-stage", "boe-prod_bad", " boe-dev"])("rejects an unconfigured or unsupported service %s", (service) => {
    expect(() => newMerchantOrderId(service)).toThrow(/payment service/u)
    expect(() => newMerchantSubscriptionId(service)).toThrow(/payment service/u)
    expect(() => newMerchantRefundId(service)).toThrow(/payment service/u)
  })

  test("the validator rejects spaces, unicode, overlong and empty ids", () => {
    expect(isValidMerchantReference("")).toBe(false)
    expect(isValidMerchantReference("has space")).toBe(false)
    expect(isValidMerchantReference("unicode-✕")).toBe(false)
    expect(isValidMerchantReference("x".repeat(64))).toBe(false)
    expect(isValidMerchantReference("ok_id-123")).toBe(true)
  })
})
