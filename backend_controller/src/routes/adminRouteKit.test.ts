import { describe, expect, test } from "vitest"

import { hashRequest } from "./adminRouteKit.js"

describe("hashRequest", () => {
  test("the same request hashes the same regardless of key order", () => {
    const left = hashRequest({ slug: "a", terms: { name: "N", category: "C" }, aumPaise: "1" })
    const right = hashRequest({ aumPaise: "1", terms: { category: "C", name: "N" }, slug: "a" })
    expect(left.toString("hex")).toBe(right.toString("hex"))
  })

  test("a change anywhere in a nested body changes the hash", () => {
    const base = { slug: "a", terms: { name: "N", minimumSipPaise: 500000 } }
    const changed = { slug: "a", terms: { name: "N", minimumSipPaise: 999900 } }
    expect(hashRequest(base).toString("hex")).not.toBe(hashRequest(changed).toString("hex"))
  })

  test("array order is significant, because per-fund lists are ordered commands", () => {
    const left = hashRequest({ items: [{ fundId: "a" }, { fundId: "b" }] })
    const right = hashRequest({ items: [{ fundId: "b" }, { fundId: "a" }] })
    expect(left.toString("hex")).not.toBe(right.toString("hex"))
  })

  test("an absent optional field and an explicit undefined hash alike", () => {
    expect(hashRequest({ slug: "a" }).toString("hex"))
      .toBe(hashRequest({ slug: "a", note: undefined }).toString("hex"))
  })

  test("an explicit null is distinct from an absent field", () => {
    expect(hashRequest({ slug: "a" }).toString("hex"))
      .not.toBe(hashRequest({ slug: "a", note: null }).toString("hex"))
  })
})
