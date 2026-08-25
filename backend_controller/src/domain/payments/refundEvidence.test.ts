import { describe, expect, test } from "vitest"

import { isRefundEvidenceCorrelated } from "./refundEvidence.js"

describe("isRefundEvidenceCorrelated", () => {
  test("accepts an exact amount and original merchant order", () => {
    expect(isRefundEvidenceCorrelated({
      expectedAmountPaise: "10000",
      expectedMerchantOrderId: "BOE_ORDER_1",
      expectedProviderRefundId: "PROVIDER_REFUND_1",
      providerRefundId: "PROVIDER_REFUND_1",
      amountPaise: "10000",
      originalMerchantOrderId: "BOE_ORDER_1",
    })).toBe(true)
  })

  test("rejects completed evidence without a returned provider refund identifier", () => {
    const providerRefundIds = [null, ""] as const
    const correlations = providerRefundIds.map((providerRefundId) =>
      isRefundEvidenceCorrelated({
        expectedAmountPaise: "10000",
        expectedMerchantOrderId: "BOE_ORDER_1",
        expectedProviderRefundId: null,
        providerRefundId,
        amountPaise: "10000",
        originalMerchantOrderId: "BOE_ORDER_1",
      }),
    )

    expect(correlations).toEqual([false, false])
  })

  test("rejects a mismatched refund amount", () => {
    expect(isRefundEvidenceCorrelated({
      expectedAmountPaise: "10000",
      expectedMerchantOrderId: "BOE_ORDER_1",
      expectedProviderRefundId: null,
      providerRefundId: null,
      amountPaise: "9999",
      originalMerchantOrderId: "BOE_ORDER_1",
    })).toBe(false)
  })

  test("rejects a missing or mismatched original merchant order", () => {
    expect(isRefundEvidenceCorrelated({
      expectedAmountPaise: "10000",
      expectedMerchantOrderId: "BOE_ORDER_1",
      expectedProviderRefundId: null,
      providerRefundId: null,
      amountPaise: "10000",
      originalMerchantOrderId: null,
    })).toBe(false)
    expect(isRefundEvidenceCorrelated({
      expectedAmountPaise: "10000",
      expectedMerchantOrderId: "BOE_ORDER_1",
      expectedProviderRefundId: null,
      providerRefundId: null,
      amountPaise: "10000",
      originalMerchantOrderId: "BOE_ORDER_2",
    })).toBe(false)
  })

  test("rejects a mismatched stored provider refund identifier", () => {
    expect(isRefundEvidenceCorrelated({
      expectedAmountPaise: "10000",
      expectedMerchantOrderId: "BOE_ORDER_1",
      expectedProviderRefundId: "PROVIDER_REFUND_1",
      providerRefundId: "PROVIDER_REFUND_2",
      amountPaise: "10000",
      originalMerchantOrderId: "BOE_ORDER_1",
    })).toBe(false)
  })
})
