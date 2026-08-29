import { afterEach, describe, expect, it, vi } from "vitest"

import { hasPlugin, isNative } from "~/platform/capacitor"
import { BRIDGED_PLUGINS, bridgeNativePlugins } from "~/platform/plugins"
import {
  onAppStateChange,
  onHardwareBack,
  onPause,
  onResume,
} from "~/platform/lifecycle"

const flush = async (): Promise<void> => {
  await new Promise((settle) => {
    setTimeout(settle, 0)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("native plugin bridge", () => {
  it("exposes no bridged plugin before registration, which is the defect this guards", () => {
    for (const name of BRIDGED_PLUGINS) expect(hasPlugin(name)).toBe(false)
  })

  it("makes every plugin the app calls reachable through window.Capacitor.Plugins", () => {
    bridgeNativePlugins()

    for (const name of BRIDGED_PLUGINS) expect(hasPlugin(name)).toBe(true)
    expect(BRIDGED_PLUGINS).toContain("App")
    expect(BRIDGED_PLUGINS).toContain("AppUpdate")
    expect(BRIDGED_PLUGINS).toContain("NativeBiometric")
  })

  it("registers once, so a second call does not warn about a duplicate plugin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    bridgeNativePlugins()
    bridgeNativePlugins()

    expect(warn).not.toHaveBeenCalled()
  })

  it("still reports the web platform, so no native-only path opens in a browser", () => {
    bridgeNativePlugins()

    expect(isNative()).toBe(false)
  })

  it("subscribes and unsubscribes lifecycle events in a browser, where no plugin is implemented", async () => {
    bridgeNativePlugins()

    const stops = [
      onHardwareBack(() => undefined),
      onResume(() => undefined),
      onPause(() => undefined),
      onAppStateChange(() => undefined),
    ]

    expect(stops).toHaveLength(4)
    await flush()
    for (const stop of stops) stop()
    await flush()
  })
})
