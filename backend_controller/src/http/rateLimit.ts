import { AppError } from "./errorCatalog.js"

export interface FixedWindowRateLimiterConfig {
  readonly windowMs: number
  readonly maxRequests: number
}

export interface FixedWindowRateLimiter {
  readonly hit: (key: string) => void
}

interface RateLimitBucket {
  windowStartedAtMs: number
  count: number
}

const SWEEP_THRESHOLD = 10_000

export const createFixedWindowRateLimiter = (
  config: FixedWindowRateLimiterConfig,
  clock: () => Date,
): FixedWindowRateLimiter => {
  const buckets = new Map<string, RateLimitBucket>()

  const sweepExpired = (nowMs: number): void => {
    for (const [key, bucket] of buckets) {
      if (nowMs - bucket.windowStartedAtMs >= config.windowMs) buckets.delete(key)
    }
  }

  return {
    hit: (key) => {
      const nowMs = clock().getTime()
      if (buckets.size >= SWEEP_THRESHOLD) sweepExpired(nowMs)
      const bucket = buckets.get(key)
      if (bucket === undefined || nowMs - bucket.windowStartedAtMs >= config.windowMs) {
        buckets.set(key, { windowStartedAtMs: nowMs, count: 1 })
        return
      }
      bucket.count += 1
      if (bucket.count > config.maxRequests) {
        throw new AppError("RATE_LIMITED", {
          retryAfterSeconds: Math.ceil((bucket.windowStartedAtMs + config.windowMs - nowMs) / 1000),
        })
      }
    },
  }
}
