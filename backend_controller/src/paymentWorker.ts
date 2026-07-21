/**
 * Payment settlement worker entrypoint. Runs a single settlement pass over the
 * due `payment` provider-call outbox events and exits — designed to be scheduled
 * (cron / process manager) in the deploy stack, like other worker passes. With
 * the placeholder "manual" provider this is what advances a paid order to
 * `booked` and materializes holdings in the running app.
 */
import { pathToFileURL } from "node:url"

import { composePaymentSettlementWorker, type PaymentSettlementWorker } from "./runtime/composition.js"
import { parseRuntimeEnvironment } from "./runtime/environment.js"
import { createRuntimeLogger } from "./runtime/logger.js"

interface PassLogger {
  info: (object: Record<string, unknown>, message: string) => void
}

export interface RunPaymentSettlementPassOptions {
  readonly worker?: PaymentSettlementWorker
  readonly logger?: PassLogger
}

export const runPaymentSettlementPass = async (
  options: RunPaymentSettlementPassOptions = {},
): Promise<void> => {
  const worker = options.worker ?? composePaymentSettlementWorker(process.env)
  const logger = options.logger ?? createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  try {
    const summary = await worker.runOnce()
    logger.info({ ...summary }, "Payment settlement pass complete")
  } finally {
    await worker.dispose()
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const logger = createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  void runPaymentSettlementPass({ logger }).catch(() => {
    logger.error({ errorCode: "PAYMENT_WORKER_FAILURE" }, "Payment settlement pass failed")
    process.exitCode = 1
  })
}
