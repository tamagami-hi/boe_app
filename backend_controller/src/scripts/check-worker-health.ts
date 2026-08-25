import { fileURLToPath } from "node:url"

import { parseDatabaseConfig } from "../db/config.js"
import { createDatabase } from "../db/database.js"
import { createPool } from "../db/pool.js"
import { createWorkerHeartbeatRepository, type WorkerHeartbeatRepository } from "../repositories/workerHeartbeatRepository.js"

export interface CheckWorkerHealthInput {
  readonly workerName: string
  readonly maxAgeSeconds: number
  readonly nowMs: number
  readonly repository: WorkerHeartbeatRepository
  readonly database: { readonly destroy: () => Promise<void> }
}

export interface CheckWorkerHealthResult {
  readonly exitCode: number
  readonly message: string
}

export const checkWorkerHealth = async (input: CheckWorkerHealthInput): Promise<CheckWorkerHealthResult> => {
  const { workerName, maxAgeSeconds, nowMs, repository, database } = input
  try {
    const heartbeat = await repository.findLatestByWorker(database as unknown as Parameters<WorkerHeartbeatRepository["findLatestByWorker"]>[0], workerName)
    if (heartbeat === null) {
      return { exitCode: 1, message: `No heartbeat found for worker ${workerName}` }
    }
    const ageSeconds = (nowMs - new Date(heartbeat.pass_completed_at as unknown as Date).getTime()) / 1000
    if (ageSeconds > maxAgeSeconds) {
      return { exitCode: 1, message: `Worker ${workerName} heartbeat is ${Math.round(ageSeconds)}s old (max ${maxAgeSeconds}s)` }
    }
    if (!heartbeat.success) {
      return { exitCode: 1, message: `Worker ${workerName} last pass failed` }
    }
    return { exitCode: 0, message: `Worker ${workerName} healthy (last pass ${Math.round(ageSeconds)}s ago)` }
  } finally {
    await input.database.destroy()
  }
}

export const runCli = async (argv: readonly string[], env: NodeJS.ProcessEnv, nowMs: number): Promise<number> => {
  const WORKER_NAME = argv[2]
  const MAX_AGE_SECONDS = Number(argv[3] ?? "120")

  if (WORKER_NAME === undefined || Number.isNaN(MAX_AGE_SECONDS) || MAX_AGE_SECONDS <= 0) {
    console.error("Usage: check-worker-health <worker-name> <max-age-seconds>")
    return 2
  }

  const pool = createPool(parseDatabaseConfig(env))
  const database = createDatabase(pool)
  const result = await checkWorkerHealth({
    workerName: WORKER_NAME,
    maxAgeSeconds: MAX_AGE_SECONDS,
    nowMs,
    repository: createWorkerHeartbeatRepository(),
    database: { destroy: () => database.destroy() },
  })
  const writer = result.exitCode === 0 ? console.log : console.error
  writer(result.message)
  return result.exitCode
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runCli(process.argv, process.env, Date.now()).then(
    (exitCode) => process.exit(exitCode),
    (error: unknown) => {
      console.error(String(error))
      process.exit(1)
    },
  )
}
