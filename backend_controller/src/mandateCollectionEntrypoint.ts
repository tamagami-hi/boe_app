import { pathToFileURL } from "node:url"

import { createUnitOfWork } from "./db/database.js"
import { composeMandateCollectionWorker, type MandateCollectionWorker } from "./runtime/composition.js"
import { parseRuntimeEnvironment } from "./runtime/environment.js"
import { createRuntimeLogger } from "./runtime/logger.js"
import { createWorkerHeartbeatRepository } from "./repositories/workerHeartbeatRepository.js"

interface PassLogger {
  info: (object: Record<string, unknown>, message: string) => void
  warn: (object: Record<string, unknown>, message: string) => void
}

export interface RunMandateCollectionPassOptions {
  readonly worker?: MandateCollectionWorker
  readonly logger?: PassLogger
}

const WORKER_NAME = "mandate_collection"

export const runMandateCollectionWorkerPass = async (options: RunMandateCollectionPassOptions = {}): Promise<void> => {
  const logger = options.logger ?? createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  const worker = options.worker ?? composeMandateCollectionWorker(process.env, logger)
  const passStartedAt = new Date()
  let success = true
  let errorCode: string | undefined
  let summary: Record<string, unknown> = {}
  try {
    if (!worker.gatewayConfigured) logger.warn({ errorCode: "PAYMENT_GATEWAY_NOT_CONFIGURED" }, "No PhonePe gateway is configured")
    summary = (await worker.runOnce()) as unknown as Record<string, unknown>
    logger.info({ ...summary, gatewayConfigured: worker.gatewayConfigured }, "Mandate collection pass complete")
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

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const logger = createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  void runMandateCollectionWorkerPass({ logger }).catch(() => {
    logger.error({ errorCode: "MANDATE_COLLECTION_WORKER_FAILURE" }, "Mandate collection pass failed")
    process.exitCode = 1
  })
}
