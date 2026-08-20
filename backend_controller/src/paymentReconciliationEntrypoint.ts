import { pathToFileURL } from "node:url"

import { composePaymentReconciliationWorker, type PaymentReconciliationWorker } from "./runtime/composition.js"
import { parseRuntimeEnvironment } from "./runtime/environment.js"
import { createRuntimeLogger } from "./runtime/logger.js"

interface PassLogger {
  info: (object: Record<string, unknown>, message: string) => void
  warn: (object: Record<string, unknown>, message: string) => void
}

export interface RunPaymentReconciliationPassOptions {
  readonly worker?: PaymentReconciliationWorker
  readonly logger?: PassLogger
}

export const runPaymentReconciliationPass = async (
  options: RunPaymentReconciliationPassOptions = {},
): Promise<void> => {
  const worker = options.worker ?? composePaymentReconciliationWorker(process.env)
  const logger = options.logger ?? createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  try {
    if (!worker.gatewayConfigured) {
      logger.warn(
        { errorCode: "PAYMENT_GATEWAY_NOT_CONFIGURED" },
        "No PhonePe gateway is configured: this pass will resolve nothing. Set PHONEPE_CLIENT_ID and the other PHONEPE_* variables.",
      )
    }
    const summary = await worker.runOnce()
    logger.info({ ...summary, gatewayConfigured: worker.gatewayConfigured }, "Payment reconciliation pass complete")
  } finally {
    await worker.dispose()
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const logger = createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  void runPaymentReconciliationPass({ logger }).catch(() => {
    logger.error({ errorCode: "PAYMENT_WORKER_FAILURE" }, "Payment reconciliation pass failed")
    process.exitCode = 1
  })
}
