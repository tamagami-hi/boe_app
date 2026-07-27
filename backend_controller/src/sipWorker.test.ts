import { describe, expect, test, vi } from "vitest"

import { runSipInstallmentPass } from "./sipWorker.js"

const EMPTY = { due: 0, generated: 0, skipped: 0, completed: 0 } as const

describe("runSipInstallmentPass", () => {
  test("runs one pass and disposes the worker", async () => {
    const runOnce = vi.fn().mockResolvedValue(EMPTY)
    const dispose = vi.fn().mockResolvedValue(undefined)
    const logger = { info: vi.fn() }

    await runSipInstallmentPass({ worker: { runOnce, dispose }, logger })

    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledTimes(1)
  })

  test("disposes the worker even when the pass throws", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    const runOnce = vi.fn().mockRejectedValue(new Error("boom"))
    const logger = { info: vi.fn() }

    await expect(runSipInstallmentPass({ worker: { runOnce, dispose }, logger })).rejects.toThrow("boom")
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
