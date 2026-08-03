import { describe, expect, test, vi } from "vitest"

import { runEmailDispatchPass } from "./emailWorker.js"

const EMPTY_SUMMARY = {
  claimed: 0,
  sent: 0,
  retried: 0,
  deadLettered: 0,
  cancelled: 0,
  skipped: 0,
} as const

describe("runEmailDispatchPass", () => {
  test("runs one pass and disposes the worker", async () => {
    const runOnce = vi.fn().mockResolvedValue(EMPTY_SUMMARY)
    const dispose = vi.fn().mockResolvedValue(undefined)
    const logger = { info: vi.fn() }

    await runEmailDispatchPass({ worker: { runOnce, dispose }, logger })

    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ sent: 0 }), expect.any(String))
  })

  test("disposes the pool even when the pass throws", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    const runOnce = vi.fn().mockRejectedValue(new Error("boom"))
    const logger = { info: vi.fn() }

    await expect(runEmailDispatchPass({ worker: { runOnce, dispose }, logger })).rejects.toThrow("boom")
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
