import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isNativeShell } from "~/lib/env"
import type * as Env from "~/lib/env"
import {
  compareDeployedBuild,
  WEB_VERSION_INTERVAL_MS,
  WEB_VERSION_PATH,
  watchWebVersion,
  type VersionLoader,
} from "~/platform/webVersion"

vi.mock("~/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof Env>()),
  isNativeShell: vi.fn(() => false),
}))

const RUNNING = { version: "0.18.2", target: "admin" } as const

const manifest = (body: unknown, status = 200): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status })

const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  delete window.Capacitor
  vi.mocked(isNativeShell).mockReturnValue(false)
})

afterEach(() => {
  delete window.Capacitor
  vi.useRealTimers()
})

describe("the deployed web build against the running one", () => {
  it("counts a different version of the same target as replaced, a rollback included", () => {
    expect(compareDeployedBuild({ version: "0.18.3", target: "admin" }, RUNNING)).toBe("replaced")
    expect(compareDeployedBuild({ version: "0.18.1", target: "admin" }, RUNNING)).toBe("replaced")
    expect(compareDeployedBuild({ version: "0.18.3", target: "admin", builtAt: "2026-12-01" }, RUNNING)).toBe(
      "replaced",
    )
  })

  it("counts the running version as current", () => {
    expect(compareDeployedBuild({ version: "0.18.2", target: "admin" }, RUNNING)).toBe("current")
  })

  it.each([
    null,
    "<!doctype html><html></html>",
    {},
    { version: "", target: "admin" },
    { version: 183, target: "admin" },
    { version: "0.18.3" },
    { version: "0.18.3", target: "client" },
  ])("never reads %j as a replaced build", (body) => {
    expect(compareDeployedBuild(body, RUNNING)).toBe("unknown")
  })
})

describe("watching the deployed web build", () => {
  it.each([
    [
      "the Capacitor bridge",
      () => {
        window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" }
      },
    ],
    [
      "the https://localhost WebView origin",
      () => {
        vi.mocked(isNativeShell).mockReturnValue(true)
      },
    ],
  ])("never asks for the manifest when %s marks the native app, whatever wakes it", async (_signal, asNative) => {
    asNative()
    vi.useFakeTimers()
    const load = vi.fn<VersionLoader>(() => Promise.resolve(manifest({ version: "0.18.3", target: "admin" })))
    const onDeployed = vi.fn()

    const stop = watchWebVersion({ running: RUNNING, onDeployed, load })
    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(WEB_VERSION_INTERVAL_MS * 2)
    stop()

    expect(load).not.toHaveBeenCalled()
    expect(onDeployed).not.toHaveBeenCalled()
  })

  it("in a browser, reads the manifest uncached on start and on focus and reports the replaced build", async () => {
    const load = vi
      .fn<VersionLoader>()
      .mockResolvedValueOnce(manifest({ version: "0.18.2", target: "admin" }))
      .mockResolvedValueOnce(manifest({ version: "0.18.3", target: "admin" }))
    const onDeployed = vi.fn()

    const stop = watchWebVersion({ running: RUNNING, onDeployed, load })
    await vi.waitFor(() => {
      expect(onDeployed).toHaveBeenCalledWith("current")
    })
    window.dispatchEvent(new Event("focus"))
    await vi.waitFor(() => {
      expect(onDeployed).toHaveBeenLastCalledWith("replaced")
    })
    stop()

    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledWith(WEB_VERSION_PATH, expect.objectContaining({ cache: "no-store" }))
  })

  it("reports nothing when the manifest cannot be read", async () => {
    const load = vi
      .fn<VersionLoader>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(manifest("Not found", 404))
      .mockResolvedValueOnce(manifest("<!doctype html><html></html>"))
    const onDeployed = vi.fn()

    const stop = watchWebVersion({ running: RUNNING, onDeployed, load })
    for (let wake = 0; wake < 2; wake += 1) {
      await settle()
      window.dispatchEvent(new Event("focus"))
    }
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledTimes(3)
    })
    await settle(50)
    stop()

    expect(onDeployed).not.toHaveBeenCalled()
  })
})
