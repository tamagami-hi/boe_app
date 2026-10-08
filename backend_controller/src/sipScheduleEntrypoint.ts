import { pathToFileURL } from "node:url"

import { createUnitOfWork } from "./db/database.js"
import { composeSipScheduleWorker, type SipScheduleWorker } from "./runtime/workerComposition.js"
import { parseRuntimeEnvironment } from "./runtime/environment.js"
import { createRuntimeLogger } from "./runtime/logger.js"
import { createWorkerHeartbeatRepository } from "./repositories/workerHeartbeatRepository.js"

interface PassLogger {
  info: (object: Record<string, unknown>, message: string) => void
  warn: (object: Record<string, unknown>, message: string) => void
}

export interface RunSipSchedulePassOptions {
  readonly worker?: SipScheduleWorker
  readonly logger?: PassLogger
}

const WORKER_NAME = "sip_schedule"

export const runSipSchedulePass = async (options: RunSipSchedulePassOptions = {}): Promise<void> => {
  const worker = options.worker ?? composeSipScheduleWorker(process.env)
  const logger = options.logger ?? createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  const passStartedAt = new Date()
  let success = true
  let errorCode: string | undefined
  let summary: Record<string, unknown> = {}
  try {
    summary = (await worker.runOnce()) as unknown as Record<string, unknown>
    logger.info({ ...summary }, "SIP schedule pass complete")
  } catch (error) {
    success = false
    errorCode = error instanceof Error ? error.name : "UNKNOWN_ERROR"
    throw error
  } finally {
    try {
      const unitOfWork = createUnitOfWork(worker.database)
      await unitOfWork.execute((tx) =>
        createWorkerHeartbeatRepository().recordHeartbeat(tx, {
          workerName: WORKER_NAME,
          passStartedAt,
          passCompletedAt: new Date(),
          success,
          summary,
          errorCode,
        }),
      )
    } catch (heartbeatError) {
      logger.warn({ error: String(heartbeatError), errorCode: "HEARTBEAT_RECORD_FAILED" }, "Failed to record worker heartbeat")
    }
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
