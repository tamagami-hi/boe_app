import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createClientRuntime } from "~/shells/client/clientRuntime"

const ACCESS_KEY = "boe.client.accessToken"
const REFRESH_KEY = "boe.client.refreshToken"
const PRINCIPAL_KEY = "boe.client.principal"

const installNativeBridge = (): Map<string, string> => {
  const vault = new Map<string, string>()
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      SecureStoragePlugin: {
        keys: () => Promise.resolve({ value: [...vault.keys()] }),
        get: (options?: Readonly<Record<string, unknown>>) =>
          Promise.resolve({ value: vault.get(String(options?.key)) ?? null }),
        set: (options?: Readonly<Record<string, unknown>>) => {
          vault.set(String(options?.key), String(options?.value))
          return Promise.resolve({ value: true })
        },
        remove: (options?: Readonly<Record<string, unknown>>) => {
          vault.delete(String(options?.key))
          return Promise.resolve({ value: true })
        },
      },
    },
  }
  return vault
}

beforeEach(() => {
  localStorage.clear()
  delete window.Capacitor
})

afterEach(() => {
  localStorage.clear()
  delete window.Capacitor
})

describe("client runtime credential persistence", () => {
  it("persists secrets to secure storage on native and never to localStorage", async () => {
    const vault = installNativeBridge()

    const runtime = createClientRuntime()
    runtime.tokenStore.update("client", { accessToken: "access", refreshToken: "refresh" })
    await Promise.resolve()

    expect(vault.get(ACCESS_KEY)).toBe("access")
    expect(vault.get(REFRESH_KEY)).toBe("refresh")
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it("purges any localStorage secrets on native start, so an earlier web session leaves nothing behind", () => {
    localStorage.setItem(ACCESS_KEY, "leaked-access")
    localStorage.setItem(REFRESH_KEY, "leaked-refresh")
    installNativeBridge()

    createClientRuntime()

    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it("keeps the principal readable in a browser", () => {
    const runtime = createClientRuntime()

    runtime.tokenStore.update("client", { principal: "{}" })

    expect(localStorage.getItem(PRINCIPAL_KEY)).toBe("{}")
  })

  it("documents that the browser client still persists secrets to localStorage, pending client-scope cookie refresh", () => {
    const runtime = createClientRuntime()

    runtime.tokenStore.update("client", { accessToken: "access", refreshToken: "refresh" })

    expect(runtime.tokenStore.read("client", "accessToken")).toBe("access")
    expect(localStorage.getItem(ACCESS_KEY)).toBe("access")
    expect(localStorage.getItem(REFRESH_KEY)).toBe("refresh")
  })

  it("recovers a browser session across a full document load, which every hard navigation performs", async () => {
    const first = createClientRuntime()
    first.tokenStore.update("client", { accessToken: "access", refreshToken: "refresh" })

    const second = createClientRuntime()
    await second.tokenStore.hydrate()

    expect(second.tokenStore.read("client", "accessToken")).toBe("access")
    expect(second.tokenStore.read("client", "refreshToken")).toBe("refresh")
  })
})
