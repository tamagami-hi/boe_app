import { describe, expect, test } from "vitest"

import { AppError } from "../http/errorCatalog.js"

import { createPasswordWorkGate } from "./passwordGate.js"

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve = (): void => {}
  const promise = new Promise<void>((resolveFn) => {
    resolve = resolveFn
  })
  return { promise, resolve }
}

describe("createPasswordWorkGate", () => {
  test("runs up to maxConcurrent hashes at once and queues the rest", async () => {
    const gate = createPasswordWorkGate({ maxConcurrent: 2, maxQueued: 8 })
    const first = deferred()
    const second = deferred()
    const third = deferred()

    const running = [
      gate.run(() => first.promise),
      gate.run(() => second.promise),
      gate.run(() => third.promise),
    ]
    // Two in flight, the third waiting — not started, and not rejected either.
    await Promise.resolve()
    expect(gate.stats()).toEqual({ active: 2, queued: 1 })

    first.resolve()
    second.resolve()
    third.resolve()
    await Promise.all(running)
    expect(gate.stats()).toEqual({ active: 0, queued: 0 })
  })

  test("rejects with a retryable RATE_LIMITED once the queue is full", async () => {
    const gate = createPasswordWorkGate({ maxConcurrent: 1, maxQueued: 1 })
    const held = deferred()
    const active = gate.run(() => held.promise)
    const queued = gate.run(() => Promise.resolve("queued"))

    // The queue holds exactly one; the next caller is turned away immediately
    // rather than joining an unbounded line and timing out later.
    await expect(gate.run(() => Promise.resolve("rejected"))).rejects.toBeInstanceOf(AppError)
    await expect(gate.run(() => Promise.resolve("rejected"))).rejects.toMatchObject({
      code: "RATE_LIMITED",
    })

    held.resolve()
    await active
    await expect(queued).resolves.toBe("queued")
  })

  test("hands the slot to the next waiter in order, and frees it when work throws", async () => {
    const gate = createPasswordWorkGate({ maxConcurrent: 1, maxQueued: 4 })
    const order: number[] = []
    const held = deferred()

    const first = gate.run(async () => {
      await held.promise
      order.push(1)
      throw new Error("hashing blew up")
    })
    const second = gate.run(() => {
      order.push(2)
      return Promise.resolve()
    })
    const third = gate.run(() => {
      order.push(3)
      return Promise.resolve()
    })

    held.resolve()
    await expect(first).rejects.toThrow("hashing blew up")
    await Promise.all([second, third])

    expect(order).toEqual([1, 2, 3])
    // A thrown hash must not leak its slot, or the gate would close permanently.
    expect(gate.stats()).toEqual({ active: 0, queued: 0 })
  })

  test("a saturated gate recovers once work drains", async () => {
    const gate = createPasswordWorkGate({ maxConcurrent: 1, maxQueued: 0 })
    const held = deferred()
    const active = gate.run(() => held.promise)

    await expect(gate.run(() => Promise.resolve("no"))).rejects.toMatchObject({ code: "RATE_LIMITED" })
    held.resolve()
    await active

    await expect(gate.run(() => Promise.resolve("yes"))).resolves.toBe("yes")
  })
})
