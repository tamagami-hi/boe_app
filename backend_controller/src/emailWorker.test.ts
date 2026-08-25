import type { Kysely } from "kysely"
import { describe, expect, test, vi } from "vitest"

import type { Database } from "./db/types.js"
import { runEmailDispatchPass } from "./emailWorker.js"

const fakeDatabase = (): Kysely<Database> =>
  ({
    transaction: () => ({ execute: vi.fn().mockResolvedValue({}) }),
  }) as unknown as Kysely<Database>

const EMPTY_SUMMARY = {
  claimed: 0,
  sent: 0,
  retried: 0,
  deadLettered: 0,
  cancelled: 0,
  skipped: 0,
} as const

const testLogger = () => ({ info: vi.fn(), warn: vi.fn() })

describe("runEmailDispatchPass", () => {
  test("runs one pass and disposes the worker", async () => {
    const runOnce = vi.fn().mockResolvedValue(EMPTY_SUMMARY)
    const dispose = vi.fn().mockResolvedValue(undefined)
    const logger = testLogger()

    await runEmailDispatchPass({ worker: { runOnce, dispose, transportConfigured: true, database: fakeDatabase() }, logger })

    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ sent: 0 }), expect.any(String))
  })

  test("disposes the pool even when the pass throws", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    const runOnce = vi.fn().mockRejectedValue(new Error("boom"))
    const logger = testLogger()

    await expect(
      runEmailDispatchPass({ worker: { runOnce, dispose, transportConfigured: true, database: fakeDatabase() }, logger }),
    ).rejects.toThrow("boom")
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  /*
   * A stack deployed with no EMAIL_SMTP_* looked entirely healthy: the worker ran
   * on schedule, exited zero, and logged a completed pass, while every delivery
   * failed retryably and no mail was sent for a day. The pass must say so.
   */
  test("warns before the pass when no transport is configured", async () => {
    const runOnce = vi.fn().mockResolvedValue(EMPTY_SUMMARY)
    const dispose = vi.fn().mockResolvedValue(undefined)
    const logger = testLogger()

    await runEmailDispatchPass({ worker: { runOnce, dispose, transportConfigured: false, database: fakeDatabase() }, logger })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "EMAIL_TRANSPORT_NOT_CONFIGURED" }),
      expect.stringContaining("EMAIL_SMTP_HOST"),
    )
    // Still runs: the point is visibility, not refusing to drain the queue.
    expect(runOnce).toHaveBeenCalledTimes(1)
  })

  test("does not warn when a transport is configured", async () => {
    const logger = testLogger()
    await runEmailDispatchPass({
      worker: {
        runOnce: vi.fn().mockResolvedValue(EMPTY_SUMMARY),
        dispose: vi.fn().mockResolvedValue(undefined),
        transportConfigured: true,
        database: fakeDatabase(),
      },
      logger,
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
