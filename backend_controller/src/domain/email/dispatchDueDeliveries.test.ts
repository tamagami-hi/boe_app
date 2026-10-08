import { randomBytes } from "node:crypto"
import { describe, expect, test, vi } from "vitest"

import { createCryptoContext, parseCryptoKeys } from "../../crypto/context.js"
import type { UnitOfWork } from "../../db/database.js"
import type { EmailDelivery, OutboxEvent, Transaction } from "../../db/repositories.js"
import type { EmailSendAttemptOutcome, OutboxState } from "../../db/types.js"
import type { SesEmailSender, SesSendResult } from "../../email/ports.js"
import { MAX_ATTEMPTS } from "../../email/retrySchedule.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { OutboxClaim, OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import { dispatchDueDeliveries, type DispatchConfig, type DispatchDeps } from "./dispatchDueDeliveries.js"

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type OutboxRow = Mutable<OutboxEvent>
type DeliveryRow = Mutable<EmailDelivery>

interface AttemptRow {
  outboxEventId: string
  generation: number
  workerId: string
  startedAt: Date
  finishedAt: Date | null
  outcome: EmailSendAttemptOutcome | null
  errorCode: string | null
  messageId: string | null
}

interface World {
  readonly clock: () => Date
  readonly advance: (ms: number) => void
  readonly outbox: Map<string, OutboxRow>
  readonly deliveries: Map<string, DeliveryRow>
  readonly attempts: AttemptRow[]
  readonly add: (id: string, outbox?: Partial<OutboxRow>, delivery?: Partial<DeliveryRow>) => void
  beforeDeliveryLock: (() => void) | null
}

const T0 = new Date("2026-03-01T10:00:00.000Z")
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs)
const key = (): string => randomBytes(32).toString("base64")

const crypto = createCryptoContext(
  parseCryptoKeys({
    CRYPTO_TOKEN_HASH_KEY: key(),
    CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
    CRYPTO_CONSENT_IP_HMAC_KEY: key(),
    CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
    CRYPTO_RECIPIENT_HMAC_KEY: key(),
    CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
    CRYPTO_RECIPIENT_ENC_KEY: key(),
    CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
  }),
)

const transaction = {} as unknown as Transaction
const unitOfWork: UnitOfWork = { execute: (operation) => operation(transaction) }

const createWorld = (): World => {
  let nowMs = T0.getTime()
  const outbox = new Map<string, OutboxRow>()
  const deliveries = new Map<string, DeliveryRow>()
  const world: World = {
    clock: () => new Date(nowMs),
    advance: (ms) => {
      nowMs += ms
    },
    outbox,
    deliveries,
    attempts: [],
    beforeDeliveryLock: null,
    add: (id, outboxOverrides = {}, deliveryOverrides = {}) => {
      const email = `${id}@example.com`
      const envelope = crypto.encryptRecipient(email)
      const createdAt = at(outbox.size)
      outbox.set(id, {
        id,
        topic: "email",
        event_type: "user.account_approved",
        event_version: 1,
        aggregate_type: "user",
        aggregate_id: `aggregate-${id}`,
        occurred_at: T0,
        request_id: `request-${id}`,
        causation_id: null,
        correlation_id: null,
        deduplication_key: `dedup-${id}`,
        payload: { template: "account_approved", downloadUrl: "https://downloads.test/boe.apk" },
        state: "pending",
        attempt_count: 0,
        lease_generation: 0,
        available_at: T0,
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        delivered_at: null,
        cancelled_at: null,
        last_error_code: null,
        created_at: createdAt,
        updated_at: T0,
        ...outboxOverrides,
      })
      deliveries.set(`d-${id}`, {
        id: `d-${id}`,
        outbox_event_id: id,
        application_id: `application-${id}`,
        user_id: null,
        template_key: "account_approved",
        template_version: "v1",
        recipient_ciphertext: envelope.ciphertext,
        recipient_nonce: envelope.nonce,
        recipient_hmac: crypto.hmacRecipient(email).hash,
        recipient_masked: "a***@example.com",
        recipient_encryption_key_version: envelope.keyVersion,
        suppression_hmac_key_version: crypto.suppressionHmacKeyVersion,
        ses_configuration_set: "boe-transactional",
        ses_message_id: null,
        ses_request_id: null,
        state: "queued",
        attempt_count: 0,
        last_attempt_at: null,
        last_error_code: null,
        failure_detail_ciphertext: null,
        failure_detail_nonce: null,
        failure_detail_key_version: null,
        sent_at: null,
        delivered_at: null,
        bounced_at: null,
        complained_at: null,
        cancelled_at: null,
        erased_at: null,
        created_at: createdAt,
        updated_at: T0,
        version: "1",
        ...deliveryOverrides,
      })
    },
  }
  return world
}

const outboxOf = (world: World, id: string): OutboxRow => {
  const row = world.outbox.get(id)
  if (row === undefined) throw new Error(`no outbox row ${id}`)
  return row
}

const deliveryOf = (world: World, id: string): DeliveryRow => {
  const row = world.deliveries.get(`d-${id}`)
  if (row === undefined) throw new Error(`no delivery for ${id}`)
  return row
}

const attemptOf = (world: World, id: string, generation: number): AttemptRow | undefined =>
  world.attempts.find((attempt) => attempt.outboxEventId === id && attempt.generation === generation)

const outboxModel = (world: World): OutboxWriteRepository => {
  const deliveryFor = (outboxEventId: string): DeliveryRow | undefined =>
    [...world.deliveries.values()].find((delivery) => delivery.outbox_event_id === outboxEventId)
  const fenced = (claim: OutboxClaim, state: OutboxState): OutboxRow | null => {
    const row = world.outbox.get(claim.outboxEventId)
    return row !== undefined && row.lease_generation === claim.generation && row.state === state ? row : null
  }
  const clearLease = (row: OutboxRow): void => {
    row.locked_at = null
    row.locked_by = null
    row.lease_expires_at = null
  }
  const expiredBefore = (row: OutboxRow, now: Date): boolean =>
    row.lease_expires_at !== null && row.lease_expires_at.getTime() < now.getTime()

  return {
    enqueue: vi.fn(),
    claimDue: async (_tx, input) => {
      const due = [...world.outbox.values()]
        .filter(
          (row) =>
            row.topic === input.topic &&
            (row.state === "pending" || row.state === "retryable_failed") &&
            row.available_at.getTime() <= input.now.getTime() &&
            deliveryFor(row.id)?.state !== "sending",
        )
        .sort(
          (a, b) =>
            a.available_at.getTime() - b.available_at.getTime() ||
            a.created_at.getTime() - b.created_at.getTime() ||
            a.id.localeCompare(b.id),
        )
        .slice(0, input.limit)
      for (const row of due) {
        row.state = "processing"
        row.lease_generation += 1
        row.locked_at = input.now
        row.locked_by = input.workerId
        row.lease_expires_at = new Date(input.now.getTime() + input.leaseMs)
      }
      return due.map((row) => ({ ...row }))
    },
    markSending: async (_tx, input) => {
      const row = fenced(input, "processing")
      if (row === null || row.lease_expires_at === null || row.lease_expires_at.getTime() <= input.now.getTime()) {
        return false
      }
      row.state = "sending"
      row.attempt_count += 1
      world.attempts.push({
        outboxEventId: input.outboxEventId,
        generation: input.generation,
        workerId: input.workerId,
        startedAt: input.now,
        finishedAt: null,
        outcome: null,
        errorCode: null,
        messageId: null,
      })
      return true
    },
    settleDelivered: async (_tx, input) => {
      const row = fenced(input, "sending")
      if (row === null) return false
      row.state = "delivered"
      row.delivered_at = input.now
      clearLease(row)
      return true
    },
    scheduleRetry: async (_tx, input) => {
      const row = fenced(input, "sending")
      if (row === null) return false
      row.state = "retryable_failed"
      row.available_at = input.availableAt
      row.last_error_code = input.errorCode
      clearLease(row)
      return true
    },
    deadLetter: async (_tx, input) => {
      const row = fenced(input, "sending")
      if (row === null) return false
      row.state = "dead_lettered"
      row.last_error_code = input.errorCode
      clearLease(row)
      return true
    },
    cancel: async (_tx, input) => {
      const row = fenced(input, "processing")
      if (row === null) return false
      row.state = "cancelled"
      row.cancelled_at = input.now
      clearLease(row)
      return true
    },
    release: async (_tx, input) => {
      const row = fenced(input, "processing")
      if (row === null) return false
      row.state = "retryable_failed"
      row.available_at = input.now
      clearLease(row)
      return true
    },
    cancelUnsent: async (_tx, input) => {
      const delivery = deliveryFor(input.outboxEventId)
      if (delivery !== undefined && delivery.state !== "queued" && delivery.state !== "retryable_failed") return false
      const row = world.outbox.get(input.outboxEventId)
      if (
        row === undefined ||
        row.lease_generation !== input.generation ||
        !["pending", "retryable_failed", "processing"].includes(row.state)
      ) {
        return false
      }
      row.state = "cancelled"
      row.cancelled_at = input.now
      clearLease(row)
      if (delivery !== undefined) {
        delivery.state = "cancelled"
        delivery.cancelled_at = input.now
      }
      return true
    },
    recordAttemptResult: async (_tx, input) => {
      const attempt = world.attempts.find(
        (candidate) => candidate.outboxEventId === input.outboxEventId && candidate.generation === input.generation,
      )
      if (attempt === undefined || (attempt.outcome !== null && attempt.outcome !== "unknown")) return
      attempt.finishedAt = input.now
      attempt.outcome = input.outcome
      attempt.errorCode = input.errorCode
      attempt.messageId = input.messageId
    },
    recoverExpiredProcessing: async (_tx, input) => {
      let recovered = 0
      for (const row of world.outbox.values()) {
        if (row.state === "processing" && expiredBefore(row, input.now) && deliveryFor(row.id)?.state !== "sending") {
          row.state = "retryable_failed"
          row.available_at = input.now
          clearLease(row)
          recovered += 1
        }
      }
      return recovered
    },
    findExpiredSending: async (_tx, input) =>
      [...world.outbox.values()]
        .filter((row) => row.state === "sending" && row.lease_generation > 0 && expiredBefore(row, input.now))
        .sort((a, b) => (a.lease_expires_at?.getTime() ?? 0) - (b.lease_expires_at?.getTime() ?? 0) || a.id.localeCompare(b.id))
        .slice(0, input.limit)
        .map((row) => ({ outboxEventId: row.id, generation: row.lease_generation, attemptCount: row.attempt_count })),
    recoverUnknownSending: async (_tx, input) => {
      const row = fenced(input, "sending")
      if (row === null || !expiredBefore(row, input.now)) return false
      if (input.resolution.kind === "retry") {
        row.state = "retryable_failed"
        row.available_at = input.resolution.availableAt
      } else {
        row.state = "dead_lettered"
      }
      row.last_error_code = input.errorCode
      clearLease(row)
      const attempt = attemptOf(world, input.outboxEventId, input.generation)
      if (attempt !== undefined && attempt.outcome === null) {
        attempt.finishedAt = input.now
        attempt.outcome = "unknown"
        attempt.errorCode = input.errorCode
      }
      return true
    },
  }
}

const deliveryModel = (world: World): EmailDeliveryWriteRepository => ({
  createAccountApprovedDelivery: vi.fn(),
  createRejectionDelivery: vi.fn(),
  adminList: vi.fn(),
  listByApplication: vi.fn(),
  lockById: vi.fn(),
  lockBySesMessageId: vi.fn(),
  applyEvidence: vi.fn(),
  lockByOutboxEventId: async (_tx, outboxEventId) => {
    world.beforeDeliveryLock?.()
    const delivery = [...world.deliveries.values()].find((candidate) => candidate.outbox_event_id === outboxEventId)
    return delivery === undefined ? null : { ...delivery }
  },
  transitionSending: async (_tx, input) => {
    const delivery = world.deliveries.get(input.deliveryId)
    if (delivery === undefined || (delivery.state !== "queued" && delivery.state !== "retryable_failed")) return
    delivery.state = "sending"
    delivery.attempt_count += 1
    delivery.last_attempt_at = input.now
  },
  recordSent: async (_tx, input) => {
    const delivery = world.deliveries.get(input.deliveryId)
    if (delivery === undefined || delivery.state !== "sending") return
    delivery.state = "sent"
    delivery.ses_message_id = input.sesMessageId
    delivery.ses_request_id = input.sesRequestId
    delivery.sent_at = input.now
    delivery.last_error_code = null
  },
  recordSendFailure: async (_tx, input) => {
    const delivery = world.deliveries.get(input.deliveryId)
    if (delivery === undefined || delivery.state !== "sending") return
    delivery.state = input.permanent ? "permanent_failed" : "retryable_failed"
    delivery.last_error_code = input.errorCode
  },
  cancel: async (_tx, input) => {
    const delivery = world.deliveries.get(input.deliveryId)
    if (delivery === undefined || !["queued", "retryable_failed", "sending"].includes(delivery.state)) return
    delivery.state = "cancelled"
    delivery.cancelled_at = input.now
  },
})

const depsFor = (
  world: World,
  workerId: string,
  sender: SesEmailSender,
  config: Partial<DispatchConfig> = {},
): DispatchDeps => ({
  unitOfWork,
  outboxRepository: outboxModel(world),
  emailDeliveryRepository: deliveryModel(world),
  emailSuppressionRepository: { findActive: async () => null, suppress: vi.fn() },
  sender,
  crypto,
  clock: world.clock,
  config: {
    topic: "email",
    workerId,
    leaseMs: 60_000,
    claimLimit: 10,
    messageBudgetMs: 25_000,
    passBudgetMs: 35_000,
    ...config,
  },
})

const accepted = (messageId: string): SesSendResult => ({ outcome: "accepted", sesMessageId: messageId, sesRequestId: null })

const countingSender = (messageId = "msg", onSend: () => void = () => undefined): SesEmailSender & { calls: number } => {
  const sender = {
    calls: 0,
    send: async (): Promise<SesSendResult> => {
      sender.calls += 1
      onSend()
      return accepted(messageId)
    },
  }
  return sender
}

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const SENDING_UNDER_EXPIRED_LEASE: Partial<OutboxRow> = {
  state: "sending",
  lease_generation: 1,
  attempt_count: 1,
  locked_at: T0,
  locked_by: "worker-dead",
  lease_expires_at: at(60_000),
}

const openAttempt = (id: string, generation: number): AttemptRow => ({
  outboxEventId: id,
  generation,
  workerId: "worker-dead",
  startedAt: T0,
  finishedAt: null,
  outcome: null,
  errorCode: null,
  messageId: null,
})

describe("dispatchDueDeliveries fencing", () => {
  const LATE_RESULTS: readonly [string, SesSendResult, Partial<AttemptRow>][] = [
    ["acceptance", accepted("a-msg"), { outcome: "accepted", messageId: "a-msg", errorCode: null }],
    [
      "transport failure",
      { outcome: "rejected", disposition: "retryable", errorCode: "SMTP_TRANSPORT_ERROR" },
      { outcome: "retryable", messageId: null, errorCode: "SMTP_TRANSPORT_ERROR" },
    ],
  ]

  test.each(LATE_RESULTS)("a stale worker's late %s is kept as its own attempt and never overwrites the newer claim", async (_name, lateResult, expectedAttempt) => {
    const world = createWorld()
    world.add("m1")
    const lateA = deferred<SesSendResult>()
    const aStarted = deferred<void>()
    const passA = dispatchDueDeliveries(
      depsFor(world, "worker-a", {
        send: () => {
          aStarted.resolve()
          return lateA.promise
        },
      }),
    )
    await aStarted.promise

    world.advance(200_000)
    const recovery = await dispatchDueDeliveries(depsFor(world, "worker-b", countingSender()))
    expect(recovery).toMatchObject({ recovered: 1, claimed: 0 })

    world.advance(80_000)
    const whileBIsSending: { outbox: string; delivery: string }[] = []
    const summaryB = await dispatchDueDeliveries(
      depsFor(world, "worker-b", {
        send: async () => {
          lateA.resolve(lateResult)
          await passA
          whileBIsSending.push({ outbox: outboxOf(world, "m1").state, delivery: deliveryOf(world, "m1").state })
          return accepted("b-msg")
        },
      }),
    )
    const summaryA = await passA

    expect(whileBIsSending).toEqual([{ outbox: "sending", delivery: "sending" }])
    expect(summaryA).toMatchObject({ claimed: 1, sent: 0, superseded: 1 })
    expect(summaryB).toMatchObject({ claimed: 1, sent: 1, superseded: 0 })
    expect(outboxOf(world, "m1")).toMatchObject({ state: "delivered", lease_generation: 2, attempt_count: 2 })
    expect(deliveryOf(world, "m1")).toMatchObject({ state: "sent", ses_message_id: "b-msg" })
    expect(attemptOf(world, "m1", 1)).toMatchObject({ workerId: "worker-a", ...expectedAttempt })
    expect(attemptOf(world, "m1", 2)).toMatchObject({ workerId: "worker-b", outcome: "accepted", messageId: "b-msg" })
  })

  test("a claim that was cancelled or outlived its lease before the send began is never sent", async () => {
    const cancelled = createWorld()
    cancelled.add("m1")
    const cancelledDeps = depsFor(cancelled, "worker-a", countingSender())
    cancelled.beforeDeliveryLock = () => {
      cancelled.beforeDeliveryLock = null
      void cancelledDeps.outboxRepository.cancelUnsent(transaction, { outboxEventId: "m1", generation: 1, now: cancelled.clock() })
    }
    const cancelledSummary = await dispatchDueDeliveries(cancelledDeps)

    const expired = createWorld()
    expired.add("m1")
    const expiredSender = countingSender()
    const promptDeps = depsFor(expired, "worker-a", expiredSender)
    const expiredSummary = await dispatchDueDeliveries({
      ...promptDeps,
      outboxRepository: {
        ...promptDeps.outboxRepository,
        claimDue: async (tx, input) => {
          const claimed = await promptDeps.outboxRepository.claimDue(tx, input)
          expired.advance(61_000)
          return claimed
        },
      },
    })

    expect(cancelledSummary).toMatchObject({ claimed: 1, sent: 0, superseded: 1 })
    expect(deliveryOf(cancelled, "m1").state).toBe("cancelled")
    expect(outboxOf(cancelled, "m1").state).toBe("cancelled")
    expect(expiredSummary).toMatchObject({ claimed: 1, sent: 0, superseded: 1 })
    expect(expiredSender.calls).toBe(0)
    expect(deliveryOf(expired, "m1").state).toBe("queued")
  })

  test("refuses to cancel once sending has committed and still settles the send", async () => {
    const world = createWorld()
    world.add("m1")
    const refusals: boolean[] = []
    const deps = depsFor(
      world,
      "worker-a",
      countingSender("msg", () => {
        void deps.outboxRepository
          .cancelUnsent(transaction, { outboxEventId: "m1", generation: 1, now: world.clock() })
          .then((cancelledNow) => refusals.push(cancelledNow))
      }),
    )

    const summary = await dispatchDueDeliveries(deps)

    expect(refusals).toEqual([false])
    expect(summary).toMatchObject({ sent: 1, superseded: 0 })
    expect(outboxOf(world, "m1").state).toBe("delivered")
    expect(deliveryOf(world, "m1")).toMatchObject({ state: "sent", cancelled_at: null })
    expect(attemptOf(world, "m1", 1)).toMatchObject({ outcome: "accepted" })
  })

  test("never cancels or claims a delivery that is already in doubt", async () => {
    const world = createWorld()
    world.add("racing")
    world.beforeDeliveryLock = () => {
      world.beforeDeliveryLock = null
      deliveryOf(world, "racing").state = "sending"
    }
    world.add("relic", { state: "retryable_failed" }, { state: "sending", attempt_count: 1 })
    const sender = countingSender()

    const first = await dispatchDueDeliveries(depsFor(world, "worker-a", sender))
    const second = await dispatchDueDeliveries(depsFor(world, "worker-a", sender))

    expect(first).toMatchObject({ claimed: 1, skipped: 1, sent: 0 })
    expect(second.claimed).toBe(0)
    expect(sender.calls).toBe(0)
    expect(deliveryOf(world, "racing")).toMatchObject({ state: "sending", cancelled_at: null })
    expect(deliveryOf(world, "relic")).toMatchObject({ state: "sending", cancelled_at: null })
    expect(outboxOf(world, "relic")).toMatchObject({ state: "retryable_failed", lease_generation: 0 })
  })
})

describe("dispatchDueDeliveries recovery", () => {
  test("a crashed in-flight send is retried later as an unknown outcome and never cancelled", async () => {
    const world = createWorld()
    world.add("m1", SENDING_UNDER_EXPIRED_LEASE, { state: "sending", attempt_count: 1 })
    world.attempts.push(openAttempt("m1", 1))
    world.advance(61_000)
    const sender = countingSender("retry-msg")

    const first = await dispatchDueDeliveries(depsFor(world, "worker-b", sender))

    const waitMs = outboxOf(world, "m1").available_at.getTime() - world.clock().getTime()
    expect(first).toMatchObject({ recovered: 1, claimed: 0, sent: 0 })
    expect(sender.calls).toBe(0)
    expect(waitMs).toBeGreaterThanOrEqual(60_000)
    expect(waitMs).toBeLessThan(72_000)
    expect(outboxOf(world, "m1")).toMatchObject({ state: "retryable_failed", lease_generation: 1, locked_by: null })
    expect(deliveryOf(world, "m1")).toMatchObject({ state: "retryable_failed", last_error_code: "SMTP_TRANSPORT_ERROR" })
    expect(deliveryOf(world, "m1").cancelled_at).toBeNull()
    expect(attemptOf(world, "m1", 1)).toMatchObject({ outcome: "unknown" })

    world.advance(73_000)
    const second = await dispatchDueDeliveries(depsFor(world, "worker-b", sender))

    expect(second).toMatchObject({ claimed: 1, sent: 1 })
    expect(outboxOf(world, "m1")).toMatchObject({ state: "delivered", attempt_count: 2, lease_generation: 2 })
    expect(deliveryOf(world, "m1")).toMatchObject({ state: "sent", attempt_count: 2 })
  })

  test("an unknown outcome counts toward the attempt budget and dead-letters at the maximum", async () => {
    const world = createWorld()
    world.add(
      "m1",
      { ...SENDING_UNDER_EXPIRED_LEASE, lease_generation: 3, attempt_count: MAX_ATTEMPTS },
      { state: "sending", attempt_count: MAX_ATTEMPTS },
    )
    world.attempts.push(openAttempt("m1", 3))
    world.advance(61_000)
    const sender = countingSender()

    const first = await dispatchDueDeliveries(depsFor(world, "worker-b", sender))
    world.advance(30 * 24 * 3_600_000)
    const later = await dispatchDueDeliveries(depsFor(world, "worker-b", sender))

    expect(first).toMatchObject({ recovered: 1, claimed: 0 })
    expect(later).toMatchObject({ recovered: 0, claimed: 0 })
    expect(sender.calls).toBe(0)
    expect(outboxOf(world, "m1")).toMatchObject({ state: "dead_lettered", attempt_count: MAX_ATTEMPTS })
    expect(deliveryOf(world, "m1")).toMatchObject({ state: "permanent_failed", attempt_count: MAX_ATTEMPTS })
    expect(attemptOf(world, "m1", 3)).toMatchObject({ outcome: "unknown" })
  })

  test("an expired claim that never reached sending returns unsent and goes out in the same pass", async () => {
    const world = createWorld()
    world.add(
      "m1",
      { state: "processing", lease_generation: 1, locked_at: T0, locked_by: "worker-dead", lease_expires_at: at(60_000) },
      { state: "queued" },
    )
    world.advance(61_000)
    const sender = countingSender()

    const summary = await dispatchDueDeliveries(depsFor(world, "worker-b", sender))

    expect(summary).toMatchObject({ recovered: 1, claimed: 1, sent: 1 })
    expect(sender.calls).toBe(1)
    expect(outboxOf(world, "m1")).toMatchObject({ state: "delivered", attempt_count: 1, lease_generation: 2 })
    expect(deliveryOf(world, "m1")).toMatchObject({ state: "sent", attempt_count: 1 })
  })

  test("legacy in-doubt rows stay exactly as recorded while a legacy unsent claim is recovered", async () => {
    const world = createWorld()
    world.add("legacy-sending", { ...SENDING_UNDER_EXPIRED_LEASE, lease_generation: 0 }, { state: "sending", attempt_count: 1 })
    world.add("legacy-relic", { state: "retryable_failed", attempt_count: 1 }, { state: "sending", attempt_count: 1 })
    world.add(
      "legacy-in-doubt-claim",
      { state: "processing", attempt_count: 1, locked_at: T0, locked_by: "old-worker", lease_expires_at: at(60_000) },
      { state: "sending", attempt_count: 1 },
    )
    world.add(
      "legacy-processing",
      { state: "processing", locked_at: T0, locked_by: "old-worker", lease_expires_at: at(60_000) },
      { state: "queued" },
    )
    world.advance(61_000)
    const inDoubt = ["legacy-sending", "legacy-relic", "legacy-in-doubt-claim"]
    const frozen = inDoubt.map((id) => ({ outbox: { ...outboxOf(world, id) }, delivery: { ...deliveryOf(world, id) } }))
    const sender = countingSender()

    const summary = await dispatchDueDeliveries(depsFor(world, "worker-b", sender))

    expect(summary).toMatchObject({ recovered: 1, claimed: 1, sent: 1 })
    expect(sender.calls).toBe(1)
    expect(outboxOf(world, "legacy-processing")).toMatchObject({ state: "delivered", lease_generation: 1 })
    expect(frozen.map((row) => row.outbox)).toEqual(inDoubt.map((id) => outboxOf(world, id)))
    expect(frozen.map((row) => row.delivery)).toEqual(inDoubt.map((id) => deliveryOf(world, id)))
    expect(world.attempts).toHaveLength(1)
  })
})

describe("dispatchDueDeliveries just-in-time claiming", () => {
  test("claims each message only when its turn comes and holds a valid lease for its whole send", async () => {
    const world = createWorld()
    for (const id of ["m1", "m2", "m3", "m4", "m5", "m6"]) world.add(id)
    const observed: { id: string; claimedAt: number; leaseCoversSend: boolean }[] = []
    const sender: SesEmailSender = {
      send: async () => {
        const claimed = [...world.outbox.values()].find((row) => row.state === "sending")
        if (claimed === undefined) throw new Error("no message is being sent")
        world.advance(3_000)
        observed.push({
          id: claimed.id,
          claimedAt: (claimed.locked_at?.getTime() ?? 0) - T0.getTime(),
          leaseCoversSend: (claimed.lease_expires_at?.getTime() ?? 0) > world.clock().getTime(),
        })
        return accepted(`msg-${claimed.id}`)
      },
    }

    const summary = await dispatchDueDeliveries(depsFor(world, "worker-a", sender))

    expect(observed).toEqual([
      { id: "m1", claimedAt: 0, leaseCoversSend: true },
      { id: "m2", claimedAt: 3_000, leaseCoversSend: true },
      { id: "m3", claimedAt: 6_000, leaseCoversSend: true },
      { id: "m4", claimedAt: 9_000, leaseCoversSend: true },
    ])
    expect(summary).toMatchObject({ claimed: 4, sent: 4 })
    for (const id of ["m5", "m6"]) {
      expect(outboxOf(world, id)).toMatchObject({ state: "pending", lease_generation: 0, locked_at: null })
    }
  })

  test("ends the pass inside its time budget even when every send takes the full send budget", async () => {
    const world = createWorld()
    for (const id of ["m1", "m2", "m3"]) world.add(id)
    const sender = countingSender("msg", () => world.advance(20_000))

    const summary = await dispatchDueDeliveries(depsFor(world, "worker-a", sender))

    expect(summary).toMatchObject({ claimed: 1, sent: 1 })
    expect(world.clock().getTime() - T0.getTime()).toBeLessThanOrEqual(35_000)
    expect(outboxOf(world, "m2")).toMatchObject({ state: "pending", lease_generation: 0 })
  })

  test("stops at the claim limit", async () => {
    const world = createWorld()
    for (const id of ["m1", "m2", "m3"]) world.add(id)
    const sender = countingSender()

    const summary = await dispatchDueDeliveries(depsFor(world, "worker-a", sender, { claimLimit: 2 }))

    expect(summary).toMatchObject({ claimed: 2, sent: 2 })
    expect(outboxOf(world, "m3").state).toBe("pending")
  })
})
