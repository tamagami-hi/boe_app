import { pathToFileURL } from "node:url"

import { createUnitOfWork } from "./db/database.js"
import { composePaymentReconciliationWorker, type PaymentReconciliationWorker } from "./runtime/composition.js"
import { parseRuntimeEnvironment } from "./runtime/environment.js"
import { createRuntimeLogger } from "./runtime/logger.js"
import { createWorkerHeartbeatRepository } from "./repositories/workerHeartbeatRepository.js"

interface PassLogger {
  info: (object: Record<string, unknown>, message: string) => void
  warn: (object: Record<string, unknown>, message: string) => void
}

export interface RunPaymentReconciliationPassOptions {
  readonly worker?: PaymentReconciliationWorker
  readonly logger?: PassLogger
  readonly dispose?: boolean
  readonly recordHeartbeat?: (input: Readonly<{
    workerName: string
    passStartedAt: Date
    passCompletedAt: Date
    success: boolean
    summary: Record<string, unknown>
    errorCode: string | undefined
  }>) => Promise<void>
}

const WORKER_NAME = "payment_reconciliation"

export const runPaymentReconciliationPass = async (
  options: RunPaymentReconciliationPassOptions = {},
): Promise<void> => {
  const logger = options.logger ?? createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  const worker = options.worker ?? composePaymentReconciliationWorker(process.env, logger)
  const passStartedAt = new Date()
  let success = true
  let errorCode: string | undefined
  let summary: Record<string, unknown> = {}
  try {
    if (!worker.gatewayConfigured) {
      logger.warn(
        { errorCode: "PAYMENT_GATEWAY_NOT_CONFIGURED" },
        "No PhonePe gateway is configured: this pass will resolve nothing. Set PHONEPE_CLIENT_ID and the other PHONEPE_* variables.",
      )
    }
    summary = (await worker.runOnce()) as unknown as Record<string, unknown>
    logger.info({ ...summary, gatewayConfigured: worker.gatewayConfigured }, "Payment reconciliation pass complete")
  } catch (error) {
    success = false
    errorCode = error instanceof Error ? error.name : "UNKNOWN_ERROR"
    throw error
  } finally {
    try {
      const recordHeartbeat = options.recordHeartbeat ?? (async (input) => {
        const unitOfWork = createUnitOfWork(worker.database)
        await unitOfWork.execute((tx) =>
          createWorkerHeartbeatRepository().recordHeartbeat(tx, input),
        )
      })
      await recordHeartbeat({
          workerName: WORKER_NAME,
          passStartedAt,
          passCompletedAt: new Date(),
          success,
          summary,
          errorCode,
      })
    } catch (heartbeatError) {
      logger.warn({ error: String(heartbeatError), errorCode: "HEARTBEAT_RECORD_FAILED" }, "Failed to record worker heartbeat")
    }
    if (options.dispose !== false) await worker.dispose()
  }
}

const waitForNextPass = (intervalMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, intervalMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })

const resolveNextDelayMs = async (
  worker: PaymentReconciliationWorker,
  logger: PassLogger,
): Promise<number> => {
  try {
    return await worker.nextWakeDelayMs()
  } catch {
    logger.warn(
      { errorCode: "PAYMENT_WORKER_WAKE_LOOKUP_FAILED", fallbackMs: worker.intervalMs },
      "Could not determine next reconciliation wake time",
    )
    return worker.intervalMs
  }
}

export interface RunPaymentReconciliationLoopOptions {
  readonly signal?: AbortSignal
}

export const runPaymentReconciliationLoop = async (
  worker: PaymentReconciliationWorker,
  logger: PassLogger,
  options: RunPaymentReconciliationLoopOptions = {},
): Promise<void> => {
  const controller = new AbortController()
  const stop = (): void => {
    controller.abort()
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  if (options.signal !== undefined) {
    if (options.signal.aborted) stop()
    else options.signal.addEventListener("abort", stop, { once: true })
  }
  try {
    while (!controller.signal.aborted) {
      try {
        await runPaymentReconciliationPass({ worker, logger, dispose: false })
      } catch {
        logger.warn({ errorCode: "PAYMENT_WORKER_PASS_FAILURE" }, "Payment reconciliation pass failed")
      }
      if (controller.signal.aborted) break
      await waitForNextPass(await resolveNextDelayMs(worker, logger), controller.signal)
    }
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    await worker.dispose()
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const logger = createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  const worker = composePaymentReconciliationWorker(process.env, logger)
  void runPaymentReconciliationLoop(worker, logger).catch(() => {
    logger.error({ errorCode: "PAYMENT_WORKER_FAILURE" }, "Payment reconciliation pass failed")
    process.exitCode = 1
  })
}
