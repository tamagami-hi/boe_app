import type { SessionScope } from "~/api/session/scope"

/**
 * The device descriptor a native login sends, and the compatibility headers that
 * accompany it.
 *
 * Both APKs need the identical shape — the backend hashes `installationId` into
 * `auth_sessions.device_id_hash` and uses it for same-device session replacement
 * — so this is one builder taking the scope rather than a copy per shell. The
 * installation id is per scope, so the admin APK and the investor APK on one
 * handset enrol as different devices, which is what keeps their per-channel
 * uniqueness and device caps independent.
 *
 * `localStorage` is the right store for it despite being readable: it is not a
 * credential, it identifies an install, and it must survive a reinstall of the
 * WebView's memory the same way it survives a browser reload.
 */
export const APP_VERSION = "0.1.0"

export type NativeDevice = Readonly<{
  installationId: string
  name: string
  platform: "android"
  appVersion: string
}>

export const NATIVE_COMPATIBILITY_HEADERS: Readonly<Record<string, string>> = {
  "x-client-platform": "android",
  "x-app-version": APP_VERSION,
}

const installationKey = (scope: SessionScope): string => `boe.${scope}.installationId`

const readInstallationId = (scope: SessionScope): string => {
  const key = installationKey(scope)
  const existing = localStorage.getItem(key)
  if (existing !== null && existing !== "") return existing
  const minted = crypto.randomUUID()
  localStorage.setItem(key, minted)
  return minted
}

const deviceName = (fallback: string): string => {
  if (typeof navigator === "undefined") return fallback
  const agent = navigator.userAgent.slice(0, 60).trim()
  return agent === "" ? fallback : agent
}

const buildNativeDevice = (scope: SessionScope, fallbackName: string): NativeDevice => ({
  installationId: readInstallationId(scope),
  name: deviceName(fallbackName),
  platform: "android",
  appVersion: APP_VERSION,
})

export const buildClientDevice = (): NativeDevice => buildNativeDevice("client", "BeOnEdge client")

export const buildAdminDevice = (): NativeDevice => buildNativeDevice("admin", "BeOnEdge admin")
