import { AppError } from "../http/errorCatalog.js"

export const CONFIRMATION_FAILURE_WINDOW_MS = 15 * 60_000
export const CONFIRMATION_FAILURE_LIMIT = 5

export interface ConfirmationAttemptLimiter {
  readonly reserve: (key: string) => void
  readonly release: (key: string) => void
}

interface AttemptWindow {
  readonly startedAtMs: number
  readonly count: number
}

export const createConfirmationAttemptLimiter = (clock: () => Date): ConfirmationAttemptLimiter => {
  const windows = new Map<string, AttemptWindow>()

  const current = (key: string, nowMs: number): AttemptWindow | null => {
    const window = windows.get(key)
    return window === undefined || nowMs - window.startedAtMs >= CONFIRMATION_FAILURE_WINDOW_MS ? null : window
  }

  return {
    reserve: (key) => {
      const nowMs = clock().getTime()
      const window = current(key, nowMs)
      if (window === null) {
        windows.set(key, { startedAtMs: nowMs, count: 1 })
        return
      }
      if (window.count >= CONFIRMATION_FAILURE_LIMIT) {
        throw new AppError("RATE_LIMITED", {
          retryAfterSeconds: Math.ceil((window.startedAtMs + CONFIRMATION_FAILURE_WINDOW_MS - nowMs) / 1000),
        })
      }
      windows.set(key, { ...window, count: window.count + 1 })
    },
    release: (key) => {
      const window = current(key, clock().getTime())
      if (window === null || window.count === 0) return
      windows.set(key, { ...window, count: window.count - 1 })
    },
  }
}
