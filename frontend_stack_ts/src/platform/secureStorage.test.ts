import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const vault = new Map<string, string>()
let available = true

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: {
    keys: () => (available ? Promise.resolve([...vault.keys()]) : Promise.reject(new Error("locked"))),
    get: (key: string) => Promise.resolve(vault.get(key) ?? null),
    set: (key: string, data: string) => {
      vault.set(key, data)
      return Promise.resolve()
    },
    remove: (key: string) => {
      const existed = vault.delete(key)
      return Promise.resolve(existed)
    },
    clear: () => {
      vault.clear()
      return Promise.resolve()
    },
  },
}))

vi.mock("~/platform/capacitor", () => ({
  isNative: () => nativeFlag,
}))

let nativeFlag = true

const load = async () => {
  const module = await import("~/platform/secureStorage")
  return module.createSecureStoragePersistence()
}

beforeEach(() => {
  vault.clear()
  available = true
  nativeFlag = true
})

afterEach(() => {
  vi.resetModules()
})

describe("secure storage persistence", () => {
  it("round-trips a credential through the plugin the package actually registers", async () => {
    const store = await load()

    await store.write("boe.client.accessToken", "access")

    expect(vault.get("boe.client.accessToken")).toBe("access")
    expect(await store.read("boe.client.accessToken")).toBe("access")
  })

  it("reports available when the vault answers", async () => {
    const store = await load()
    expect(await store.available()).toBe(true)
  })

  it("reports unavailable when the vault refuses, so the token store fails closed", async () => {
    available = false
    const store = await load()
    expect(await store.available()).toBe(false)
  })

  it("is never available off native", async () => {
    nativeFlag = false
    const store = await load()
    expect(await store.available()).toBe(false)
  })

  it("returns null rather than throwing for an absent key", async () => {
    const store = await load()
    expect(await store.read("boe.client.refreshToken")).toBeNull()
  })

  it("removes a credential and tolerates removing one that is gone", async () => {
    const store = await load()
    await store.write("boe.client.refreshToken", "refresh")

    await store.remove("boe.client.refreshToken")
    expect(vault.has("boe.client.refreshToken")).toBe(false)

    await expect(store.remove("boe.client.refreshToken")).resolves.toBeUndefined()
  })
})
