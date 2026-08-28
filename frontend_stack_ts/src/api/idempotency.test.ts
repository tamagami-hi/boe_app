import { describe, expect, it } from "vitest"

import {
  createIdempotencyKeyStore,
  fingerprintBody,
  isIdempotencyKey,
  mintIdempotencyKey,
} from "~/api/idempotency"

describe("idempotency key minting", () => {
  it("mints keys the backend header scalar accepts", () => {
    for (let index = 0; index < 20; index += 1) {
      expect(isIdempotencyKey(mintIdempotencyKey())).toBe(true)
    }
  })

  it("rejects keys outside the backend pattern", () => {
    for (const candidate of ["short", "", "has spaces here", "a".repeat(129), "bad/slash"]) {
      expect(isIdempotencyKey(candidate), candidate).toBe(false)
    }
  })
})

describe("body fingerprinting", () => {
  it("is insensitive to key order", () => {
    expect(fingerprintBody({ fundId: "f1", amountPaise: "200" })).toBe(
      fingerprintBody({ amountPaise: "200", fundId: "f1" }),
    )
  })

  it("drops undefined members so an absent field equals an undefined field", () => {
    expect(fingerprintBody({ fundId: "f1", note: undefined })).toBe(fingerprintBody({ fundId: "f1" }))
  })

  it("distinguishes a changed amount", () => {
    expect(fingerprintBody({ amountPaise: "200" })).not.toBe(fingerprintBody({ amountPaise: "300" }))
  })

  it("distinguishes a string from a number of the same shape", () => {
    expect(fingerprintBody({ amountPaise: "200" })).not.toBe(fingerprintBody({ amountPaise: 200 }))
  })

})

describe("idempotency key store", () => {
  it("returns a stable key while the body is unchanged", () => {
    const store = createIdempotencyKeyStore()
    const first = store.resolve(fingerprintBody({ amountPaise: "200" }))
    const second = store.resolve(fingerprintBody({ amountPaise: "200" }))
    expect(second).toBe(first)
  })

  it("re-mints when the body changes, so an edited request cannot collide", () => {
    const store = createIdempotencyKeyStore()
    const first = store.resolve(fingerprintBody({ amountPaise: "200" }))
    const second = store.resolve(fingerprintBody({ amountPaise: "300" }))
    expect(second).not.toBe(first)
  })

  it("does not return to a previous key when the body reverts", () => {
    const store = createIdempotencyKeyStore()
    const first = store.resolve(fingerprintBody({ amountPaise: "200" }))
    store.resolve(fingerprintBody({ amountPaise: "300" }))
    const reverted = store.resolve(fingerprintBody({ amountPaise: "200" }))
    expect(reverted).not.toBe(first)
  })

  it("keeps distinct scopes independent", () => {
    const orders = createIdempotencyKeyStore()
    const sips = createIdempotencyKeyStore()
    const fingerprint = fingerprintBody({ amountPaise: "200" })
    expect(orders.resolve(fingerprint)).not.toBe(sips.resolve(fingerprint))
  })
})
