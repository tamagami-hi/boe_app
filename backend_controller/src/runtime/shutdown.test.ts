import { EventEmitter } from "node:events"
import { setTimeout as delay } from "node:timers/promises"

import { describe, expect, test, vi } from "vitest"

import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  SHUTDOWN_SIGNALS,
  performGracefulShutdown,
  registerGracefulShutdown,
  type ShutdownSignal,
} from "./shutdown.js"

const createLogger = () => ({ info: vi.fn(), error: vi.fn() })

const resolvedCloser = () => ({ close: vi.fn(() => Promise.resolve(undefined)) })
const neverCloser = () => ({ close: vi.fn(() => new Promise<void>(() => {})) })
const rejectingCloser = () => ({
  close: vi.fn(() => Promise.reject(new Error("close boom"))),
})

describe("shutdown constants", () => {
  test("exposes the exact ordered signal set and default timeout", () => {
    expect(SHUTDOWN_SIGNALS).toEqual(["SIGTERM", "SIGINT"])
    expect(Object.isFrozen(SHUTDOWN_SIGNALS)).toBe(true)
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(10_000)
  })
})

describe("performGracefulShutdown", () => {
  test("closes the application and returns 'closed' within the bound", async () => {
    const application = resolvedCloser()
    const logger = createLogger()

    const outcome = await performGracefulShutdown({
      application,
      logger,
      signal: "SIGTERM",
      timeoutMs: 1_000,
    })

    expect(outcome).toBe("closed")
    expect(application.close).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  test("returns 'timeout' when close exceeds the deadline", async () => {
    const application = neverCloser()
    const logger = createLogger()

    const outcome = await performGracefulShutdown({
      application,
      logger,
      signal: "SIGINT",
      timeoutMs: 5,
    })

    expect(outcome).toBe("timeout")
    expect(logger.error).toHaveBeenCalled()
  })

  test("returns 'error' when close rejects", async () => {
    const application = rejectingCloser()
    const logger = createLogger()

    const outcome = await performGracefulShutdown({
      application,
      logger,
      signal: "SIGTERM",
      timeoutMs: 1_000,
    })

    expect(outcome).toBe("error")
    expect(logger.error).toHaveBeenCalled()
  })
})

describe("registerGracefulShutdown", () => {
  test("attaches a listener for every default signal and unregisters them", () => {
    const target = new EventEmitter()
    const application = resolvedCloser()
    const logger = createLogger()

    const unregister = registerGracefulShutdown({
      application,
      logger,
      target,
      exit: vi.fn(),
    })

    for (const signal of SHUTDOWN_SIGNALS) {
      expect(target.listenerCount(signal)).toBe(1)
    }

    unregister()

    for (const signal of SHUTDOWN_SIGNALS) {
      expect(target.listenerCount(signal)).toBe(0)
    }
  })

  test("drains once and exits 0 on a clean close, ignoring repeated signals", async () => {
    const target = new EventEmitter()
    const application = resolvedCloser()
    const logger = createLogger()
    const exit = vi.fn()

    registerGracefulShutdown({ application, logger, target, exit, timeoutMs: 1_000 })

    target.emit("SIGTERM")
    target.emit("SIGTERM")
    target.emit("SIGINT")
    await delay(30)

    expect(application.close).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  test("exits 1 when the drain times out", async () => {
    const target = new EventEmitter()
    const application = neverCloser()
    const logger = createLogger()
    const exit = vi.fn()

    registerGracefulShutdown({ application, logger, target, exit, timeoutMs: 5 })

    target.emit("SIGTERM")
    await delay(40)

    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
  })

  test("only registers the requested signals", () => {
    const target = new EventEmitter()
    const application = resolvedCloser()
    const logger = createLogger()
    const signals: readonly ShutdownSignal[] = ["SIGINT"]

    registerGracefulShutdown({ application, logger, target, exit: vi.fn(), signals })

    expect(target.listenerCount("SIGINT")).toBe(1)
    expect(target.listenerCount("SIGTERM")).toBe(0)
  })
})


describe("performGracefulShutdown waits for the drain to finish", () => {
  test("does not resolve 'closed' until application.close() completes", async () => {
    let closed = false
    let releaseClose = (): void => {}
    const application = {
      close: () =>
        new Promise<void>((resolve) => {
          releaseClose = (): void => {
            closed = true
            resolve()
          }
        }),
    }
    const logger = createLogger()

    const shutdown = performGracefulShutdown({
      application,
      logger,
      signal: "SIGTERM",
      timeoutMs: 2_000,
    })

    let settled = false
    void shutdown.then(() => {
      settled = true
    })
    await delay(30)
    expect(settled).toBe(false)
    expect(closed).toBe(false)

    releaseClose()
    const outcome = await shutdown
    expect(outcome).toBe("closed")
    expect(closed).toBe(true)
  })
})
