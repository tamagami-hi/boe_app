import { registerPlugin } from "@capacitor/core"

export const CORE_REGISTERED_PLUGINS = [
  "CapacitorCookies",
  "CapacitorHttp",
  "SystemBars",
  "WebView",
] as const

export const BRIDGED_PLUGINS = [
  "App",
  "AppUpdate",
  "Browser",
  "NativeBiometric",
  "SystemChrome",
] as const

let bridged = false

export const bridgeNativePlugins = (): void => {
  if (bridged) return
  bridged = true
  for (const name of BRIDGED_PLUGINS) {
    registerPlugin<Readonly<Record<string, unknown>>>(name)
  }
}
