import { describe, expect, test, vi } from "vitest"

import type { PaymentReconciliationWorker } from "./runtime/composition.js"
import { runPaymentReconciliationPass } from "./paymentReconciliationEntrypoint.js"

const worker = (runOnce: PaymentReconciliationWorker["runOnce"]) => ({
  runOnce,
  gatewayConfigured: true,
  dispose: vi.fn().mockResolvedValue(undefined),
  database: {} as PaymentReconciliationWorker["database"],
  intervalMs: 30_000,
})

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
}

describe("payment reconciliation pass lifecycle", () => {
  test("records a successful heartbeat and disposes an owned worker", async () => {
    const subject = worker(vi.fn().mockResolvedValue({
      attemptsChecked: 1,
      attemptsResolved: 1,
      refundsChecked: 0,
      refundsResolved: 0,
    }))
    const recordHeartbeat = vi.fn().mockResolvedValue(undefined)

    await runPaymentReconciliationPass({ worker: subject, logger, recordHeartbeat })

    expect(recordHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      workerName: "payment_reconciliation",
      success: true,
      summary: {
        attemptsChecked: 1,
        attemptsResolved: 1,
        refundsChecked: 0,
        refundsResolved: 0,
      },
    }))
    expect(subject.dispose).toHaveBeenCalledOnce()
  })

  test("records a failed heartbeat before propagating the pass error", async () => {
    const failure = new Error("pass failed")
    const subject = worker(vi.fn().mockRejectedValue(failure))
    const recordHeartbeat = vi.fn().mockResolvedValue(undefined)

    await expect(runPaymentReconciliationPass({ worker: subject, logger, recordHeartbeat }))
      .rejects.toBe(failure)

    expect(recordHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorCode: "Error",
    }))
    expect(subject.dispose).toHaveBeenCalledOnce()
  })

  test("warns when the gateway is unavailable and keeps the pass observable", async () => {
    const subject = {
      ...worker(vi.fn().mockResolvedValue({ attemptsChecked: 0, attemptsResolved: 0 })),
      gatewayConfigured: false,
    }
    const passLogger = { info: vi.fn(), warn: vi.fn() }

    await runPaymentReconciliationPass({
      worker: subject,
      logger: passLogger,
      recordHeartbeat: vi.fn().mockResolvedValue(undefined),
    })

    expect(passLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PAYMENT_GATEWAY_NOT_CONFIGURED" }),
      expect.any(String),
    )
  })

  test("logs a heartbeat storage failure without replacing a successful pass", async () => {
    const subject = worker(vi.fn().mockResolvedValue({ attemptsChecked: 0, attemptsResolved: 0 }))
    const passLogger = { info: vi.fn(), warn: vi.fn() }

    await expect(runPaymentReconciliationPass({
      worker: subject,
      logger: passLogger,
      recordHeartbeat: vi.fn().mockRejectedValue(new Error("database unavailable")),
    })).resolves.toBeUndefined()

    expect(passLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "HEARTBEAT_RECORD_FAILED" }),
      expect.any(String),
    )
  })
})
