export const SHUTDOWN_SIGNALS = Object.freeze(["SIGTERM", "SIGINT"] as const)

export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number]

export type ShutdownOutcome = "closed" | "timeout" | "error"

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000

type Closeable = Readonly<{ close: () => Promise<unknown> }>

type ShutdownLogger = Readonly<{
  info: (payload: Record<string, unknown>, message: string) => void
  error: (payload: Record<string, unknown>, message: string) => void
}>

type SignalTarget = Readonly<{
  on: (signal: ShutdownSignal, listener: () => void) => void
  removeListener: (signal: ShutdownSignal, listener: () => void) => void
}>

type ProcessExit = (code: number) => void

export type PerformGracefulShutdownOptions = Readonly<{
  application: Closeable
  logger: ShutdownLogger
  signal: ShutdownSignal
  timeoutMs?: number
}>

/**
 * Drains the running server on a shutdown signal within a hard bound. It always
 * resolves: `closed` when the server closes first, `timeout` when the deadline
 * wins, and `error` when close rejects. The timer is unreferenced so it never
 * keeps the event loop alive on its own, and it is always cleared.
 */
export const performGracefulShutdown = async ({
  application,
  logger,
  signal,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
}: PerformGracefulShutdownOptions): Promise<ShutdownOutcome> => {
  logger.info({ signal }, "Backend received shutdown signal")

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<ShutdownOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout")
    }, timeoutMs)
    timer.unref()
  })

  try {
    const outcome = await Promise.race<ShutdownOutcome>([
      application.close().then((): ShutdownOutcome => "closed"),
      timeoutPromise,
    ])

    if (outcome === "timeout") {
      logger.error(
        { signal, timeoutMs },
        "Backend shutdown timed out before the server closed",
      )
    } else {
      logger.info({ signal }, "Backend shutdown complete")
    }

    return outcome
  } catch {
    logger.error({ signal }, "Backend shutdown failed while closing the server")
    return "error"
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export type RegisterGracefulShutdownOptions = Readonly<{
  application: Closeable
  logger: ShutdownLogger
  signals?: readonly ShutdownSignal[]
  timeoutMs?: number
  target?: SignalTarget
  exit?: ProcessExit
}>

/**
 * Installs single-drain signal handlers. The first handled signal starts one
 * bounded shutdown; later signals are ignored so a repeated SIGTERM cannot
 * start a second drain. The process exits with `0` on a clean close and `1` on
 * a timeout or close error. Returns an unregister function for tests/cleanup.
 */
export const registerGracefulShutdown = ({
  application,
  logger,
  signals = SHUTDOWN_SIGNALS,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  target = process,
  exit = (code) => {
    process.exit(code)
  },
}: RegisterGracefulShutdownOptions): (() => void) => {
  let started = false
  const listeners = new Map<ShutdownSignal, () => void>()

  const handle = (signal: ShutdownSignal): void => {
    if (started) return
    started = true
    void performGracefulShutdown({ application, logger, signal, timeoutMs }).then(
      (outcome) => {
        exit(outcome === "closed" ? 0 : 1)
      },
    )
  }

  for (const signal of signals) {
    const listener = (): void => {
      handle(signal)
    }
    listeners.set(signal, listener)
    target.on(signal, listener)
  }

  return () => {
    for (const [signal, listener] of listeners) {
      target.removeListener(signal, listener)
    }
  }
}
