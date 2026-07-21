/**
 * Transactional-outbox repository (spec 03 §3.3/§7, 04 §6.2). Events are enqueued
 * in the same transaction as the state change; the BE-012 delivery worker claims
 * due rows with `FOR UPDATE SKIP LOCKED`, takes a lease, and drives the
 * claim -> sending -> settled state machine.
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

export interface ClaimDueInput {
  readonly topic: string
  readonly workerId: string
  readonly leaseMs: number
  readonly limit: number
  readonly now: Date
}

export interface OutboxSettleInput {
  readonly outboxEventId: string
  readonly now: Date
}

export interface OutboxRetryInput extends OutboxSettleInput {
  readonly availableAt: Date
  readonly errorCode: string
}

export interface OutboxDeadLetterInput extends OutboxSettleInput {
  readonly errorCode: string
}

export interface OutboxWriteRepository {
  enqueue: (tx: Transaction, input: EnqueueOutboxInput) => Promise<OutboxEvent>
  /** Claim due rows and place a lease; returns the claimed events in FIFO order. */
  claimDue: (tx: Transaction, input: ClaimDueInput) => Promise<readonly OutboxEvent[]>
  /** processing -> sending; the committed point of no return before SES. */
  markSending: (tx: Transaction, input: OutboxSettleInput) => Promise<void>
  /** sending -> delivered; clears the lease. */
  settleDelivered: (tx: Transaction, input: OutboxSettleInput) => Promise<void>
  /** sending -> retryable_failed with the next available time; clears the lease. */
  scheduleRetry: (tx: Transaction, input: OutboxRetryInput) => Promise<void>
  /** sending -> dead_lettered; clears the lease. */
  deadLetter: (tx: Transaction, input: OutboxDeadLetterInput) => Promise<void>
  /** any transit state -> cancelled (obsolete/suppressed work); clears the lease. */
  cancel: (tx: Transaction, input: OutboxSettleInput) => Promise<void>
  /** Return expired-lease rows to retryable_failed; returns the recovered count. */
  recoverExpiredLeases: (tx: Transaction, input: Readonly<{ now: Date }>) => Promise<number>
}

const CLEAR_LEASE = { locked_at: null, locked_by: null, lease_expires_at: null } as const

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

  claimDue: async (tx, input) => {
    const claimable = await tx
      .selectFrom("outbox_events")
      .select("id")
      .where("topic", "=", input.topic)
      .where("state", "in", ["pending", "retryable_failed"])
      .where("available_at", "<=", input.now)
      .orderBy("available_at")
      .orderBy("created_at")
      .orderBy("id")
      .limit(input.limit)
      .forUpdate()
      .skipLocked()
      .execute()

    if (claimable.length === 0) return []

    return tx
      .updateTable("outbox_events")
      .set({
        state: "processing",
        locked_at: input.now,
        locked_by: input.workerId,
        lease_expires_at: new Date(input.now.getTime() + input.leaseMs),
        updated_at: input.now,
      })
      .where(
        "id",
        "in",
        claimable.map((row) => row.id),
      )
      .returningAll()
      .execute()
  },

  markSending: async (tx, input) => {
    await tx
      .updateTable("outbox_events")
      .set({ state: "sending", attempt_count: sql<number>`attempt_count + 1`, updated_at: input.now })
      .where("id", "=", input.outboxEventId)
      .where("state", "=", "processing")
      .execute()
  },

  settleDelivered: async (tx, input) => {
    await tx
      .updateTable("outbox_events")
      .set({ state: "delivered", delivered_at: input.now, updated_at: input.now, ...CLEAR_LEASE })
      .where("id", "=", input.outboxEventId)
      .where("state", "=", "sending")
      .execute()
  },

  scheduleRetry: async (tx, input) => {
    await tx
      .updateTable("outbox_events")
      .set({
        state: "retryable_failed",
        available_at: input.availableAt,
        last_error_code: input.errorCode,
        updated_at: input.now,
        ...CLEAR_LEASE,
      })
      .where("id", "=", input.outboxEventId)
      .where("state", "=", "sending")
      .execute()
  },

  deadLetter: async (tx, input) => {
    await tx
      .updateTable("outbox_events")
      .set({ state: "dead_lettered", last_error_code: input.errorCode, updated_at: input.now, ...CLEAR_LEASE })
      .where("id", "=", input.outboxEventId)
      .where("state", "=", "sending")
      .execute()
  },

  cancel: async (tx, input) => {
    await tx
      .updateTable("outbox_events")
      .set({ state: "cancelled", cancelled_at: input.now, updated_at: input.now, ...CLEAR_LEASE })
      .where("id", "=", input.outboxEventId)
      .where("state", "in", ["processing", "sending"])
      .execute()
  },

  recoverExpiredLeases: async (tx, input) => {
    const result = await tx
      .updateTable("outbox_events")
      .set({ state: "retryable_failed", available_at: input.now, updated_at: input.now, ...CLEAR_LEASE })
      .where("state", "in", ["processing", "sending"])
      .where("lease_expires_at", "<", input.now)
      .executeTakeFirst()
    return Number(result.numUpdatedRows)
  },
})
