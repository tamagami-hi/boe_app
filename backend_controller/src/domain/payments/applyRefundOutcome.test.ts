import { describe, expect, test, vi } from "vitest"

import type { Transaction } from "../../db/repositories.js"
import type { VerifiedCallback } from "../../providers/phonepe/paymentGateway.js"
import { applyRefundOutcome, type ApplyRefundOutcomeDeps } from "./applyRefundOutcome.js"

describe("applyRefundOutcome", () => {
  test("rejects a verified refund callback without a canonical local refund", async () => {
    const deps = {
      refundRepository: {
        lockByMerchantRefundId: vi.fn().mockResolvedValue(null),
      },
    } as unknown as ApplyRefundOutcomeDeps
    const callback = {
      merchantRefundId: "boe_rf_missing",
    } as VerifiedCallback

    await expect(
      applyRefundOutcome(deps, {} as Transaction, callback, new Date("2026-08-27T00:00:00.000Z")),
    ).rejects.toThrow("refund operation not found")
  })
})
