import { sql } from "kysely"
import type { Kysely } from "kysely"

import type { Database } from "../db/types.js"
import type { MetricsRepository } from "../runtime/metrics.js"

interface HeartbeatRow {
  readonly worker_name: string
  readonly pass_started_at: Date
  readonly pass_completed_at: Date
  readonly success: boolean
}

interface CountRow {
  readonly count: string
}

export const createMetricsRepository = (database: Kysely<Database>): MetricsRepository => ({
  findLatestWorkerHeartbeats: async () => {
    const rows = await sql<HeartbeatRow>`
      SELECT DISTINCT ON (worker_name)
        worker_name,
        pass_started_at,
        pass_completed_at,
        success
      FROM worker_heartbeats
      ORDER BY worker_name, pass_completed_at DESC, id DESC
    `.execute(database)
    return rows.rows.map((row) => ({
      workerName: row.worker_name,
      passStartedAt: row.pass_started_at,
      passCompletedAt: row.pass_completed_at,
      success: row.success,
    }))
  },

  countPaymentReconciliationBacklog: async () => {
    const row = await database
      .selectFrom("payment_attempts")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("state", "in", ["created", "provider_pending"])
      .where("checkout_channel", "=", "hosted_redirect")
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  countMandateReconciliationBacklog: async () => {
    const row = await database
      .selectFrom("payment_mandates")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("state", "in", ["setup_pending", "active", "pause_pending", "paused", "cancel_pending", "revoke_pending"])
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  countSetupDispatchBacklog: async () => {
    const row = await database
      .selectFrom("mandate_setup_attempts")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("state", "in", ["created", "dispatching", "provider_pending"])
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  countCollectionNotifyBacklog: async () => {
    const row = await database
      .selectFrom("mandate_collection_attempts")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("notify_state", "in", ["created", "dispatching", "failed"])
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  countCollectionReconcileBacklog: async () => {
    const rows = await sql<CountRow>`
      SELECT count(*) AS count
      FROM mandate_collection_attempts
      JOIN payment_attempts ON payment_attempts.id = mandate_collection_attempts.payment_attempt_id
      WHERE mandate_collection_attempts.notify_state IN ('dispatching', 'notified')
        AND payment_attempts.state IN ('created', 'provider_pending')
    `.execute(database)
    return Number(rows.rows[0]?.count ?? 0)
  },

  countCancelEscalations: async () => {
    const row = await database
      .selectFrom("mandate_cancel_commands")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("state", "=", "reconciliation_required")
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  countStaleSetups: async (threshold) => {
    const row = await database
      .selectFrom("mandate_setup_attempts")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("state", "in", ["dispatching", "provider_pending"])
      .where((expression) =>
        expression.or([
          expression("last_status_checked_at", "is", null),
          expression("last_status_checked_at", "<", threshold),
        ]),
      )
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  countStaleCollections: async (threshold) => {
    const rows = await sql<CountRow>`
      SELECT count(*) AS count
      FROM mandate_collection_attempts
      JOIN payment_attempts ON payment_attempts.id = mandate_collection_attempts.payment_attempt_id
      WHERE mandate_collection_attempts.notify_state IN ('dispatching', 'notified')
        AND payment_attempts.state IN ('created', 'provider_pending')
        AND (
          payment_attempts.last_status_checked_at IS NULL
          OR payment_attempts.last_status_checked_at < ${threshold}
        )
    `.execute(database)
    return Number(rows.rows[0]?.count ?? 0)
  },
})
