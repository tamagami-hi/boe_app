import { pathToFileURL } from "node:url"

import { composeSipScheduleWorker, type SipScheduleWorker } from "./runtime/composition.js"
import { parseRuntimeEnvironment } from "./runtime/environment.js"
import { createRuntimeLogger } from "./runtime/logger.js"

interface PassLogger {
  info: (object: Record<string, unknown>, message: string) => void
}

export interface RunSipSchedulePassOptions {
  readonly worker?: SipScheduleWorker
  readonly logger?: PassLogger
}

export const runSipSchedulePass = async (options: RunSipSchedulePassOptions = {}): Promise<void> => {
  const worker = options.worker ?? composeSipScheduleWorker(process.env)
  const logger = options.logger ?? createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  try {
    const summary = await worker.runOnce()
    logger.info({ ...summary }, "SIP schedule pass complete")
  } finally {
    await worker.dispose()
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const logger = createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  void runSipSchedulePass({ logger }).catch(() => {
    logger.error({ errorCode: "SIP_SCHEDULE_WORKER_FAILURE" }, "SIP schedule pass failed")
    process.exitCode = 1
  })
}
