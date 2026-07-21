/**
 * SIP installment scheduler entrypoint. Runs a single pass that generates a
 * `sip_installment` order for each due active SIP and begins its payment, then
 * exits — designed to be scheduled (cron / process manager) in the deploy stack.
 * The payment worker + webhook then settle and book each installment.
 */
import { pathToFileURL } from "node:url"

import { composeSipInstallmentWorker, type SipInstallmentWorker } from "./runtime/composition.js"
import { parseRuntimeEnvironment } from "./runtime/environment.js"
import { createRuntimeLogger } from "./runtime/logger.js"

interface PassLogger {
  info: (object: Record<string, unknown>, message: string) => void
}

export interface RunSipInstallmentPassOptions {
  readonly worker?: SipInstallmentWorker
  readonly logger?: PassLogger
}

export const runSipInstallmentPass = async (options: RunSipInstallmentPassOptions = {}): Promise<void> => {
  const worker = options.worker ?? composeSipInstallmentWorker(process.env)
  const logger = options.logger ?? createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  try {
    const summary = await worker.runOnce()
    logger.info({ ...summary }, "SIP installment pass complete")
  } finally {
    await worker.dispose()
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const logger = createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  void runSipInstallmentPass({ logger }).catch(() => {
    logger.error({ errorCode: "SIP_WORKER_FAILURE" }, "SIP installment pass failed")
    process.exitCode = 1
  })
}
