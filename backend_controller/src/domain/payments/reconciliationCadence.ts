const MIN_WAKE_DELAY_MS = 50
const MAX_BACKOFF_EXPONENT = 10

export interface ReconciliationCadence {
  readonly fastIntervalMs: number
  readonly pendingIntervalMs: number
  readonly fastWindowMs: number
  readonly maxBackoffMs: number
  readonly expiryGraceMs: number
}

export interface AttemptCadenceInput {
  readonly now: Date
  readonly dispatchStartedAt: Date | string | null
  readonly checkoutExpiresAt: Date | string | null
}

export interface FailureCadenceInput extends AttemptCadenceInput {
  readonly failureCount: number
  readonly throttled: boolean
}

export interface WakeCadenceInput {
  readonly now: Date
  readonly earliestDueAt: Date | string | null
  readonly idleIntervalMs: number
}

const toEpochMs = (value: Date | string | null): number | null => {
  if (value === null) return null
  const epochMs = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(epochMs) ? null : epochMs
}

export const isCheckoutLive = (input: AttemptCadenceInput, expiryGraceMs: number): boolean => {
  const expiresAtMs = toEpochMs(input.checkoutExpiresAt)
  if (expiresAtMs === null) return true
  return input.now.getTime() <= expiresAtMs + expiryGraceMs
}

export const isInFastWindow = (input: AttemptCadenceInput, cadence: ReconciliationCadence): boolean => {
  const dispatchedAtMs = toEpochMs(input.dispatchStartedAt)
  if (dispatchedAtMs === null) return false
  if (!isCheckoutLive(input, cadence.expiryGraceMs)) return false
  return input.now.getTime() - dispatchedAtMs <= cadence.fastWindowMs
}

export const resolvePendingDelayMs = (
  input: AttemptCadenceInput,
  cadence: ReconciliationCadence,
): number =>
  isInFastWindow(input, cadence) ? cadence.fastIntervalMs : cadence.pendingIntervalMs

export const resolveFailureDelayMs = (
  input: FailureCadenceInput,
  cadence: ReconciliationCadence,
): number => {
  const base = input.throttled ? cadence.pendingIntervalMs * 2 : cadence.pendingIntervalMs
  const exponent = Math.min(Math.max(input.failureCount, 0), MAX_BACKOFF_EXPONENT)
  const backoffMs = Math.min(cadence.maxBackoffMs, base * 2 ** exponent)
  if (input.throttled) return backoffMs
  if (!isCheckoutLive(input, cadence.expiryGraceMs)) return backoffMs
  return Math.min(backoffMs, cadence.pendingIntervalMs)
}

export const resolveWakeDelayMs = (input: WakeCadenceInput): number => {
  const dueAtMs = toEpochMs(input.earliestDueAt)
  if (dueAtMs === null) return input.idleIntervalMs
  const delayMs = dueAtMs - input.now.getTime()
  if (delayMs <= MIN_WAKE_DELAY_MS) return MIN_WAKE_DELAY_MS
  return Math.min(input.idleIntervalMs, delayMs)
}
