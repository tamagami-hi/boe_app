import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { WorkerHeartbeatsTable } from "../db/types.js"

type HeartbeatRow = Omit<WorkerHeartbeatsTable, "summary"> & { readonly summary: Record<string, unknown> }

export interface WorkerHeartbeatSummary {
  readonly [key: string]: unknown
}

export interface RecordHeartbeatInput {
  readonly workerName: string
  readonly passStartedAt: Date
  readonly passCompletedAt: Date
  readonly success: boolean
  readonly summary: WorkerHeartbeatSummary
  readonly errorCode: string | undefined
}

export interface WorkerHeartbeatRepository {
  recordHeartbeat: (tx: Transaction, input: RecordHeartbeatInput) => Promise<HeartbeatRow>
  findLatestByWorker: (tx: Transaction, workerName: string) => Promise<HeartbeatRow | null>
  findLatestAllWorkers: (tx: Transaction) => Promise<readonly HeartbeatRow[]>
}

export const createWorkerHeartbeatRepository = (): WorkerHeartbeatRepository => ({
  recordHeartbeat: async (tx, input) =>
    (await tx
      .insertInto("worker_heartbeats")
      .values({
        worker_name: input.workerName,
        pass_started_at: input.passStartedAt,
        pass_completed_at: input.passCompletedAt,
        success: input.success,
        summary: JSON.stringify(input.summary),
        error_code: input.errorCode ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as unknown as HeartbeatRow,

  findLatestByWorker: async (tx, workerName) =>
    ((await tx
      .selectFrom("worker_heartbeats")
      .selectAll()
      .where("worker_name", "=", workerName)
      .orderBy("pass_completed_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst()) as unknown as HeartbeatRow | undefined) ?? null,

  findLatestAllWorkers: async (tx) =>
    (await sql<HeartbeatRow>`
      SELECT DISTINCT ON (worker_name) *
      FROM worker_heartbeats
      ORDER BY worker_name, pass_completed_at DESC, id DESC
    `.execute(tx)).rows as unknown as HeartbeatRow[],
})
