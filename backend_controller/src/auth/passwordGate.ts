/**
 * Bounded concurrency for Argon2id work.
 *
 * Argon2id at m=19 MiB, t=2 is deliberately expensive, and it runs on the libuv
 * threadpool — so the number of password hashes in flight is the real capacity
 * limit of sign-in, not the connection pool and not the event loop. Nothing
 * bounded it: every arriving login was accepted and queued, so under a burst
 * (or a scan of the login endpoint) every request waited behind every other one
 * and legitimate sign-ins timed out rather than being told to retry.
 *
 * Per-IP rate limiting at the edge does not solve this. It caps one source; the
 * threadpool is a shared, global resource, and a scan spread over a few dozen
 * addresses passes every per-IP limit while still saturating it. This gate is the
 * backstop that does not care where the load came from:
 *
 *   * up to `maxConcurrent` hashes run at once — sized to the threadpool, since
 *     more than that buys no throughput and only adds 19 MiB of peak memory each;
 *   * up to `maxQueued` more wait, which absorbs a normal simultaneous burst;
 *   * beyond that, callers are rejected immediately with `RATE_LIMITED` (429,
 *     marked retryable) instead of joining an unbounded queue.
 *
 * Rejecting fast is the point. A 429 the client can act on is strictly better
 * than a request that occupies a slot for thirty seconds and then fails anyway,
 * and it keeps the queue short enough that the users who *are* served are served
 * quickly.
 */
import { AppError } from "../http/errorCatalog.js"

export interface PasswordWorkGateLimits {
  readonly maxConcurrent: number
  readonly maxQueued: number
}

export interface PasswordWorkGate {
  /** Run `work` under the gate, or reject with RATE_LIMITED if the queue is full. */
  run: <TResult>(work: () => Promise<TResult>) => Promise<TResult>
  /** Current occupancy, for tests and for logging a saturation event. */
  stats: () => Readonly<{ active: number; queued: number }>
}

export const createPasswordWorkGate = (limits: PasswordWorkGateLimits): PasswordWorkGate => {
  const maxConcurrent = Math.max(1, Math.floor(limits.maxConcurrent))
  const maxQueued = Math.max(0, Math.floor(limits.maxQueued))
  let active = 0
  const waiting: Array<() => void> = []

  const acquire = (): Promise<void> => {
    if (active < maxConcurrent) {
      active += 1
      return Promise.resolve()
    }
    if (waiting.length >= maxQueued) {
      return Promise.reject(new AppError("RATE_LIMITED"))
    }
    return new Promise<void>((resolve) => {
      waiting.push(resolve)
    })
  }

  // The slot is handed straight to the next waiter rather than released and
  // re-taken, so `active` never dips and a waiter cannot be overtaken by a
  // caller arriving in between.
  const release = (): void => {
    const next = waiting.shift()
    if (next === undefined) {
      active -= 1
      return
    }
    next()
  }

  return {
    run: async (work) => {
      await acquire()
      try {
        return await work()
      } finally {
        release()
      }
    },
    stats: () => Object.freeze({ active, queued: waiting.length }),
  }
}

/**
 * Process-wide gate.
 *
 * Module-level rather than injected: every password hash and verification in the
 * process must pass through the same gate for the bound to mean anything, and
 * threading it through both login commands, signup, approval and the seed scripts
 * would leave a way to add a call site that bypasses it. `passwordHasher` is the
 * only consumer.
 */
const DEFAULT_LIMITS: PasswordWorkGateLimits = { maxConcurrent: 4, maxQueued: 64 }

let shared = createPasswordWorkGate(DEFAULT_LIMITS)

export const passwordWorkGate = (): PasswordWorkGate => shared

/** Apply configured limits at composition time (and reset between tests). */
export const configurePasswordWorkGate = (limits: PasswordWorkGateLimits): void => {
  shared = createPasswordWorkGate(limits)
}
