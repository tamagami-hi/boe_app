import { createFixedWindowRateLimiter, type FixedWindowRateLimiter } from "../http/rateLimit.js"

export const PASSWORD_RECHECK_WINDOW_MS = 15 * 60_000
export const PASSWORD_RECHECK_MAX_ATTEMPTS = 5

export const createPasswordRecheckLimiter = (clock: () => Date): FixedWindowRateLimiter =>
  createFixedWindowRateLimiter(
    { windowMs: PASSWORD_RECHECK_WINDOW_MS, maxRequests: PASSWORD_RECHECK_MAX_ATTEMPTS },
    clock,
  )
