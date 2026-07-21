import { describe, expect, test, vi } from "vitest"

import { runPaymentSettlementPass } from "./paymentWorker.js"

const EMPTY_SUMMARY = { claimed: 0, booked: 0, alreadyBooked: 0, retried: 0, deadLettered: 0 } as const

describe("runPaymentSettlementPass", () => {
  test("runs one pass and disposes the worker", async () => {
    const runOnce = vi.fn().mockResolvedValue(EMPTY_SUMMARY)
    const dispose = vi.fn().mockResolvedValue(undefined)
    const logger = { info: vi.fn() }

    await runPaymentSettlementPass({ worker: { runOnce, dispose }, logger })

    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledTimes(1)
  })

  test("disposes the worker even when the pass throws", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    const runOnce = vi.fn().mockRejectedValue(new Error("boom"))
    const logger = { info: vi.fn() }

    await expect(
      runPaymentSettlementPass({ worker: { runOnce, dispose }, logger }),
    ).rejects.toThrow("boom")
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
