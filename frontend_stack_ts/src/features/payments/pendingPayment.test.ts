import { describe, expect, it } from "vitest"

import { PendingPaymentWriteFailed } from "~/features/payments/checkout"
import {
  PENDING_PAYMENT_KEY,
  persistPendingPayment,
  readPendingPayment,
} from "~/features/payments/pendingPayment"
import type { PendingPaymentStore } from "~/features/payments/pendingPayment"

const memoryStore = (): PendingPaymentStore & { readonly map: Map<string, string> } => {
  const map = new Map<string, string>()
  return {
    map,
    read: (key) => map.get(key) ?? null,
    write: (key, value) => {
      map.set(key, value)
    },
    remove: (key) => {
      map.delete(key)
    },
  }
}

const pending = {
  kind: "order_payment",
  paymentId: "payment-1",
  orderId: "order-1",
  ownerId: "user-1",
  expiresAt: 2_000,
} as const

const pendingMandate = {
  kind: "mandate_setup",
  paymentId: "payment-2",
  orderId: "order-2",
  sipPlanId: "sip-1",
  ownerId: "user-1",
  expiresAt: 2_000,
} as const

describe("persistPendingPayment", () => {
  it("records the pending payment so a return has a route back", () => {
    const store = memoryStore()
    persistPendingPayment(store, pending)
    expect(readPendingPayment(store, "user-1", 1_000)).toEqual(pending)
  })

  it("records a mandate setup with the plan needed to route back to it", () => {
    const store = memoryStore()
    persistPendingPayment(store, pendingMandate)
    expect(readPendingPayment(store, "user-1", 1_000)).toEqual(pendingMandate)
  })

  it("fails when the write throws, so the caller can abort the checkout", () => {
    const store: PendingPaymentStore = {
      read: () => null,
      write: () => {
        throw new Error("storage is full")
      },
      remove: () => undefined,
    }
    expect(() => {
      persistPendingPayment(store, pending)
    }).toThrow(PendingPaymentWriteFailed)
  })

  it("fails when the write silently does not persist", () => {
    const store: PendingPaymentStore = {
      read: () => null,
      write: () => undefined,
      remove: () => undefined,
    }
    expect(() => {
      persistPendingPayment(store, pending)
    }).toThrow(PendingPaymentWriteFailed)
  })
})

describe("readPendingPayment", () => {
  it("ignores a pending payment belonging to another account and keeps it", () => {
    const store = memoryStore()
    persistPendingPayment(store, pending)
    expect(readPendingPayment(store, "user-2", 1_000)).toBeNull()
    expect(store.map.has(PENDING_PAYMENT_KEY)).toBe(true)
  })

  it("discards an expired pending payment", () => {
    const store = memoryStore()
    persistPendingPayment(store, pending)
    expect(readPendingPayment(store, "user-1", 2_000)).toBeNull()
    expect(store.map.has(PENDING_PAYMENT_KEY)).toBe(false)
  })

  it("discards a corrupt record instead of trusting it", () => {
    const store = memoryStore()
    store.write(PENDING_PAYMENT_KEY, "{not json")
    expect(readPendingPayment(store, "user-1", 1_000)).toBeNull()
    expect(store.map.has(PENDING_PAYMENT_KEY)).toBe(false)
  })

  it("discards a record missing required fields", () => {
    const store = memoryStore()
    store.write(PENDING_PAYMENT_KEY, JSON.stringify({ paymentId: "payment-1" }))
    expect(readPendingPayment(store, "user-1", 1_000)).toBeNull()
    expect(store.map.has(PENDING_PAYMENT_KEY)).toBe(false)
  })

  it("discards a mandate setup with no plan to route back to", () => {
    const store = memoryStore()
    store.write(
      PENDING_PAYMENT_KEY,
      JSON.stringify({
        kind: "mandate_setup",
        paymentId: "payment-2",
        orderId: "order-2",
        ownerId: "user-1",
        expiresAt: 2_000,
      }),
    )
    expect(readPendingPayment(store, "user-1", 1_000)).toBeNull()
    expect(store.map.has(PENDING_PAYMENT_KEY)).toBe(false)
  })

  it("discards a record whose kind it does not recognise", () => {
    const store = memoryStore()
    store.write(PENDING_PAYMENT_KEY, JSON.stringify({ ...pending, kind: "something_else" }))
    expect(readPendingPayment(store, "user-1", 1_000)).toBeNull()
    expect(store.map.has(PENDING_PAYMENT_KEY)).toBe(false)
  })

  it("returns null when nothing is stored", () => {
    expect(readPendingPayment(memoryStore(), "user-1", 1_000)).toBeNull()
  })
})
