/**
 * Outbox email retry schedule (spec 04 §6.2). Pure functions: no clock, no I/O.
 *
 * The initial send is attempt 1. After a *retryable* failure the worker
 * reschedules using a fixed backoff ladder with up to 20% deterministic jitter
 * derived from the outbox event id and the attempt number, so the same failed
 * attempt always computes the same delay (idempotent reschedule) while spreading
 * concurrent retries. After eight total attempts the row is dead-lettered.
 */
import { createHmac } from "node:crypto"

/** Backoff ladder applied after attempts 1..7 (index = attemptCount - 1). */
export const RETRY_DELAYS_MS: readonly number[] = Object.freeze([
  60_000, // 1 minute
  300_000, // 5 minutes
  900_000, // 15 minutes
  3_600_000, // 1 hour
  14_400_000, // 4 hours
  43_200_000, // 12 hours
  86_400_000, // 24 hours
])

/** Maximum total send attempts before dead-lettering. */
export const MAX_ATTEMPTS = 8

/** Fraction of the base delay added as jitter never reaches this bound. */
export const MAX_JITTER_FRACTION = 0.2

/**
 * Deterministic jitter fraction in [0, MAX_JITTER_FRACTION) from a stable seed.
 * Uses the first 4 bytes of HMAC-SHA-256(seed) so it is uniform and reproducible
 * without persisting a jitter column.
 */
export const jitterFraction = (seed: string): number => {
  const digest = createHmac("sha256", "boe-outbox-jitter-v1").update(seed).digest()
  const sample = digest.readUInt32BE(0) / 0x1_00_00_00_00
  return sample * MAX_JITTER_FRACTION
}

/**
 * Delay in milliseconds before the next attempt given how many attempts have
 * already been made, or `null` when the cap is reached (caller dead-letters).
 * `attemptCount` is the number of attempts completed so far (>= 1).
 */
export const nextRetryDelayMs = (attemptCount: number, eventId: string): number | null => {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error("attemptCount must be a positive integer")
  }
  if (attemptCount >= MAX_ATTEMPTS) return null
  const base = RETRY_DELAYS_MS[attemptCount - 1]
  if (base === undefined) return null
  const jitter = jitterFraction(`${eventId}:${String(attemptCount)}`)
  return Math.round(base * (1 + jitter))
}

/** Whether a completed attempt count has exhausted the retry budget. */
export const isExhausted = (attemptCount: number): boolean => attemptCount >= MAX_ATTEMPTS

/**
 * Classify a transport/SES failure. Throttling, timeouts, connection errors, and
 * SES 5xx are retryable; validated SES 4xx configuration/address failures are
 * permanent. Throttling is the one 4xx that is retryable.
 */
export type SesFailureKind =
  | "throttling"
  | "timeout"
  | "connection"
  | "server_5xx"
  | "client_4xx"
  | "rendering"

export const classifyFailure = (kind: SesFailureKind): "retryable" | "permanent" => {
  switch (kind) {
    case "throttling":
    case "timeout":
    case "connection":
    case "server_5xx":
      return "retryable"
    case "client_4xx":
    case "rendering":
      return "permanent"
  }
}
