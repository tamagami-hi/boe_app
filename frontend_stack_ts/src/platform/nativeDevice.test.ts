import { NativeAuthHeaders, NativeLoginBody } from "@beonedge/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"

const HARD_CODED_VERSION = "0.1.0"

const loadWithBuildVersion = async (version: string) => {
  vi.resetModules()
  vi.stubEnv("VITE_BEO_APP_VERSION", version)
  return import("~/platform/nativeDevice")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  localStorage.clear()
})

describe("native app version", () => {
  it.each(["0.18.0", "0.18.1-dev.4.g0b337a0.dirty"])(
    "sends build version %s, not 0.1.0, as x-app-version and device.appVersion the server accepts",
    async (version) => {
      const native = await loadWithBuildVersion(version)
      const headers = native.NATIVE_COMPATIBILITY_HEADERS
      const devices = [native.buildClientDevice(), native.buildAdminDevice()]

      expect(headers["x-app-version"]).toBe(version)
      expect(headers["x-app-version"]).not.toBe(HARD_CODED_VERSION)
      expect(NativeAuthHeaders.safeParse(headers).success).toBe(true)
      for (const device of devices) {
        expect(device.appVersion).toBe(version)
        expect(NativeLoginBody.shape.device.safeParse(device).success).toBe(true)
      }
    },
  )
})
