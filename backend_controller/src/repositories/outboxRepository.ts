/**
 * Transactional-outbox repository (spec 03 §3.3/§7, 04 §6.2). Events are enqueued
 * in the same transaction as the state change; the BE-012 delivery worker claims
 * due rows with `FOR UPDATE SKIP LOCKED`, takes a lease, and drives the
 * claim -> sending -> settled state machine.
 */
import { sql } from "kysely"
import type { ExpressionBuilder } from "kysely"

import type { OutboxEvent, Transaction } from "../db/repositories.js"
import type { Database, EmailSendAttemptOutcome, OutboxState } from "../db/types.js"

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

export interface OutboxClaim {
  readonly outboxEventId: string
  readonly generation: number
}

export interface MarkSendingInput extends OutboxClaim {
  readonly workerId: string
  readonly now: Date
}

export interface OutboxSettleInput extends OutboxClaim {
  readonly now: Date
}

export interface OutboxRetryInput extends OutboxSettleInput {
  readonly availableAt: Date
  readonly errorCode: string
}

export interface OutboxDeadLetterInput extends OutboxSettleInput {
  readonly errorCode: string
}

export interface RecordAttemptResultInput extends OutboxSettleInput {
  readonly outcome: Exclude<EmailSendAttemptOutcome, "unknown">
  readonly errorCode: string | null
  readonly messageId: string | null
}

export interface ExpiredSendingAttempt extends OutboxClaim {
  readonly attemptCount: number
}

export type UnknownSendingResolution =
  | { readonly kind: "retry"; readonly availableAt: Date }
  | { readonly kind: "dead_letter" }

export interface RecoverUnknownSendingInput extends OutboxSettleInput {
  readonly errorCode: string
  readonly resolution: UnknownSendingResolution
}

export interface OutboxWriteRepository {
  enqueue: (tx: Transaction, input: EnqueueOutboxInput) => Promise<OutboxEvent>
  /** Claim due rows and place a lease; returns the claimed events in FIFO order. */
  claimDue: (tx: Transaction, input: ClaimDueInput) => Promise<readonly OutboxEvent[]>
  /** processing -> sending; the committed point of no return before SES. */
  markSending: (tx: Transaction, input: MarkSendingInput) => Promise<boolean>
  /** sending -> delivered; clears the lease. */
  settleDelivered: (tx: Transaction, input: OutboxSettleInput) => Promise<boolean>
  /** sending -> retryable_failed with the next available time; clears the lease. */
  scheduleRetry: (tx: Transaction, input: OutboxRetryInput) => Promise<boolean>
  /** sending -> dead_lettered; clears the lease. */
  deadLetter: (tx: Transaction, input: OutboxDeadLetterInput) => Promise<boolean>
  cancel: (tx: Transaction, input: OutboxSettleInput) => Promise<boolean>
  release: (tx: Transaction, input: OutboxSettleInput) => Promise<boolean>
  cancelUnsent: (tx: Transaction, input: OutboxSettleInput) => Promise<boolean>
  recordAttemptResult: (tx: Transaction, input: RecordAttemptResultInput) => Promise<void>
  recoverExpiredProcessing: (tx: Transaction, input: Readonly<{ now: Date }>) => Promise<number>
  findExpiredSending: (
    tx: Transaction,
    input: Readonly<{ now: Date; limit: number }>,
  ) => Promise<readonly ExpiredSendingAttempt[]>
  recoverUnknownSending: (tx: Transaction, input: RecoverUnknownSendingInput) => Promise<boolean>
}

const CLEAR_LEASE = { locked_at: null, locked_by: null, lease_expires_at: null } as const

const appliedToOne = (result: { readonly numUpdatedRows: bigint }): boolean => Number(result.numUpdatedRows) === 1

const withoutInDoubtDelivery = (eb: ExpressionBuilder<Database, "outbox_events">) =>
  eb.not(
    eb.exists(
      eb
        .selectFrom("email_deliveries")
        .select("email_deliveries.id")
        .whereRef("email_deliveries.outbox_event_id", "=", "outbox_events.id")
        .where("email_deliveries.state", "=", "sending"),
    ),
  )

const fenced = (tx: Transaction, claim: OutboxClaim, state: OutboxState) =>
  tx
    .updateTable("outbox_events")
    .where("id", "=", claim.outboxEventId)
    .where("lease_generation", "=", claim.generation)
    .where("state", "=", state)

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
      .where(withoutInDoubtDelivery)
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
        lease_generation: sql<number>`lease_generation + 1`,
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
    const result = await fenced(tx, input, "processing")
      .where("lease_expires_at", ">", input.now)
      .set({ state: "sending", attempt_count: sql<number>`attempt_count + 1`, updated_at: input.now })
      .executeTakeFirst()
    if (!appliedToOne(result)) return false
    await tx
      .insertInto("email_send_attempts")
      .values({
        outbox_event_id: input.outboxEventId,
        generation: input.generation,
        worker_id: input.workerId,
        started_at: input.now,
      })
      .execute()
    return true
  },

  settleDelivered: async (tx, input) =>
    appliedToOne(
      await fenced(tx, input, "sending")
        .set({ state: "delivered", delivered_at: input.now, updated_at: input.now, ...CLEAR_LEASE })
        .executeTakeFirst(),
    ),

  scheduleRetry: async (tx, input) =>
    appliedToOne(
      await fenced(tx, input, "sending")
        .set({
          state: "retryable_failed",
          available_at: input.availableAt,
          last_error_code: input.errorCode,
          updated_at: input.now,
          ...CLEAR_LEASE,
        })
        .executeTakeFirst(),
    ),

  deadLetter: async (tx, input) =>
    appliedToOne(
      await fenced(tx, input, "sending")
        .set({ state: "dead_lettered", last_error_code: input.errorCode, updated_at: input.now, ...CLEAR_LEASE })
        .executeTakeFirst(),
    ),

  cancel: async (tx, input) =>
    appliedToOne(
      await fenced(tx, input, "processing")
        .set({ state: "cancelled", cancelled_at: input.now, updated_at: input.now, ...CLEAR_LEASE })
        .executeTakeFirst(),
    ),

  release: async (tx, input) =>
    appliedToOne(
      await fenced(tx, input, "processing")
        .set({ state: "retryable_failed", available_at: input.now, updated_at: input.now, ...CLEAR_LEASE })
        .executeTakeFirst(),
    ),

  cancelUnsent: async (tx, input) => {
    const delivery = await tx
      .selectFrom("email_deliveries")
      .select(["id", "state"])
      .where("outbox_event_id", "=", input.outboxEventId)
      .forUpdate()
      .executeTakeFirst()
    if (delivery !== undefined && delivery.state !== "queued" && delivery.state !== "retryable_failed") return false

    const result = await tx
      .updateTable("outbox_events")
      .set({ state: "cancelled", cancelled_at: input.now, updated_at: input.now, ...CLEAR_LEASE })
      .where("id", "=", input.outboxEventId)
      .where("lease_generation", "=", input.generation)
      .where("state", "in", ["pending", "retryable_failed", "processing"])
      .executeTakeFirst()
    if (!appliedToOne(result)) return false

    if (delivery !== undefined) {
      await tx
        .updateTable("email_deliveries")
        .set({
          state: "cancelled",
          cancelled_at: input.now,
          updated_at: input.now,
          version: sql<string>`version + 1`,
        })
        .where("id", "=", delivery.id)
        .execute()
    }
    return true
  },

  recordAttemptResult: async (tx, input) => {
    await tx
      .updateTable("email_send_attempts")
      .set({
        finished_at: input.now,
        outcome: input.outcome,
        error_code: input.errorCode,
        message_id: input.messageId,
      })
      .where("outbox_event_id", "=", input.outboxEventId)
      .where("generation", "=", input.generation)
      .where((eb) => eb.or([eb("outcome", "is", null), eb("outcome", "=", "unknown")]))
      .execute()
  },

  recoverExpiredProcessing: async (tx, input) => {
    const result = await tx
      .updateTable("outbox_events")
      .set({ state: "retryable_failed", available_at: input.now, updated_at: input.now, ...CLEAR_LEASE })
      .where("state", "=", "processing")
      .where("lease_expires_at", "<", input.now)
      .where(withoutInDoubtDelivery)
      .executeTakeFirst()
    return Number(result.numUpdatedRows)
  },

  findExpiredSending: async (tx, input) => {
    const rows = await tx
      .selectFrom("outbox_events")
      .select(["id", "lease_generation", "attempt_count"])
      .where("state", "=", "sending")
      .where("lease_generation", ">", 0)
      .where("lease_expires_at", "<", input.now)
      .orderBy("lease_expires_at")
      .orderBy("id")
      .limit(input.limit)
      .execute()
    return rows.map((row) => ({
      outboxEventId: row.id,
      generation: row.lease_generation,
      attemptCount: row.attempt_count,
    }))
  },

  recoverUnknownSending: async (tx, input) => {
    const resolution = input.resolution
    const outcome =
      resolution.kind === "retry"
        ? { state: "retryable_failed" as const, available_at: resolution.availableAt }
        : { state: "dead_lettered" as const }
    const result = await fenced(tx, input, "sending")
      .where("lease_expires_at", "<", input.now)
      .set({ ...outcome, last_error_code: input.errorCode, updated_at: input.now, ...CLEAR_LEASE })
      .executeTakeFirst()
    if (!appliedToOne(result)) return false
    await tx
      .updateTable("email_send_attempts")
      .set({ finished_at: input.now, outcome: "unknown", error_code: input.errorCode })
      .where("outbox_event_id", "=", input.outboxEventId)
      .where("generation", "=", input.generation)
      .where("outcome", "is", null)
      .execute()
    return true
  },
})
