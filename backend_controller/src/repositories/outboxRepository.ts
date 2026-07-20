/**
 * Transactional-outbox repository (spec 03 §3.3/§7). Events are enqueued in the
 * same transaction as the state change; a background worker (BE-012) claims and
 * delivers them after commit.
 */
import { sql } from "kysely"

import type { OutboxEvent, Transaction } from "../db/repositories.js"

export interface EnqueueOutboxInput {
  readonly topic: string
  readonly eventType: string
  readonly eventVersion: number
  readonly aggregateType: string
  readonly aggregateId: string
  readonly requestId: string
  readonly deduplicationKey: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface OutboxWriteRepository {
  enqueue: (tx: Transaction, input: EnqueueOutboxInput) => Promise<OutboxEvent>
}

export const createOutboxRepository = (): OutboxWriteRepository => ({
  enqueue: async (tx, input) =>
    tx
      .insertInto("outbox_events")
      .values({
        topic: input.topic,
        event_type: input.eventType,
        event_version: input.eventVersion,
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        // occurred_at equals the transaction time so it never post-dates created_at.
        occurred_at: sql<Date>`now()`,
        request_id: input.requestId,
        deduplication_key: input.deduplicationKey,
        payload: JSON.stringify(input.payload),
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
})
