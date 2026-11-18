import { beforeEach, describe, expect, it } from "vitest"

import { createWhatsNewSeen, type DurableSeenStore, whatsNewSeenKey } from "./whatsNewSeen"

const USER = "11111111-1111-4111-8111-111111111111"
const KEY = whatsNewSeenKey("client", USER)

const memoryStore = (initial: ReadonlyMap<string, string> = new Map()): DurableSeenStore => {
  let saved = initial
  return {
    readAll: () => Promise.resolve(saved),
    write: (key, entryId) => {
      saved = new Map([...saved, [key, entryId]])
      return Promise.resolve()
    },
  }
}

const refusingStore: DurableSeenStore = {
  readAll: () => Promise.reject(new Error("IndexedDB is not available.")),
  write: () => {
    throw new Error("IndexedDB is not available.")
  },
}

const afterReads = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

const localStorageOnly = () => window.localStorage

beforeEach(() => {
  window.localStorage.clear()
})

describe("the What's new seen id", () => {
  it("still counts Done after the app is killed before localStorage reaches disk", async () => {
    const durable = memoryStore()
    createWhatsNewSeen(localStorageOnly, durable).markSeen("client", USER, "0.18.4")
    window.localStorage.setItem(KEY, "0.18.3")

    const reopened = createWhatsNewSeen(localStorageOnly, durable)
    await afterReads()

    expect(reopened.lastSeen("client", USER)).toBe("0.18.4")
  })

  it("keeps a later release that only localStorage holds, comparing release numbers rather than text", async () => {
    window.localStorage.setItem(KEY, "0.18.10")

    const seen = createWhatsNewSeen(localStorageOnly, memoryStore(new Map([[KEY, "0.18.9"]])))
    await afterReads()

    expect(seen.lastSeen("client", USER)).toBe("0.18.10")
  })

  it("falls back to localStorage when the durable store cannot be used", async () => {
    window.localStorage.setItem(KEY, "0.18.3")

    const seen = createWhatsNewSeen(localStorageOnly, refusingStore)
    await afterReads()
    expect(seen.lastSeen("client", USER)).toBe("0.18.3")

    seen.markSeen("client", USER, "0.18.4")
    expect(window.localStorage.getItem(KEY)).toBe("0.18.4")
  })
})
