/**
 * Outbox email delivery worker entrypoint. Runs a single delivery pass over the
 * due `email` outbox events and exits, so the deploy stack can schedule it the
 * same way it schedules the payment and SIP passes.
 *
 * This is the process that actually gets onboarding mail out of the database:
 * address verification at signup and the activation invite after approval. With
 * no pass running, both sit in `outbox_events` as `pending` and no investor can
 * activate an account.
 */
import { pathToFileURL } from "node:url"

import { composeEmailDispatchWorker, type EmailDispatchWorker } from "./runtime/composition.js"
import { parseRuntimeEnvironment } from "./runtime/environment.js"
import { createRuntimeLogger } from "./runtime/logger.js"

interface PassLogger {
  info: (object: Record<string, unknown>, message: string) => void
}

export interface RunEmailDispatchPassOptions {
  readonly worker?: EmailDispatchWorker
  readonly logger?: PassLogger
}

export const runEmailDispatchPass = async (options: RunEmailDispatchPassOptions = {}): Promise<void> => {
  const worker = options.worker ?? composeEmailDispatchWorker(process.env)
  const logger = options.logger ?? createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  try {
    const summary = await worker.runOnce()
    logger.info({ ...summary }, "Email delivery pass complete")
  } finally {
    await worker.dispose()
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const logger = createRuntimeLogger({ level: parseRuntimeEnvironment(process.env).logLevel })
  void runEmailDispatchPass({ logger }).catch(() => {
    logger.error({ errorCode: "EMAIL_WORKER_FAILURE" }, "Email delivery pass failed")
    process.exitCode = 1
  })
}
