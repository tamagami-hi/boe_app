import { platformError } from "~/platform/errors"

export type PluginCall = (options?: Readonly<Record<string, unknown>>) => Promise<unknown>

type PluginRecord = Readonly<Record<string, unknown>>

type CapacitorBridge = Readonly<{
  getPlatform?: () => string
  isNativePlatform?: () => boolean
  Plugins?: Readonly<Record<string, PluginRecord | undefined>>
}>

declare global {
  interface Window {
    Capacitor?: CapacitorBridge
  }
}

const bridge = (): CapacitorBridge | null => {
  if (typeof window === "undefined") return null
  return window.Capacitor ?? null
}

export const isNative = (): boolean => bridge()?.isNativePlatform?.() === true

export const platformName = (): "android" | "ios" | "web" => {
  const name = bridge()?.getPlatform?.()
  if (name === "android" || name === "ios") return name
  return "web"
}

export const isAndroid = (): boolean => platformName() === "android"

export const plugin = (name: string): PluginRecord | null => bridge()?.Plugins?.[name] ?? null

export const hasPlugin = (name: string): boolean => plugin(name) !== null

export const callPlugin = async (
  pluginName: string,
  method: string,
  options?: Readonly<Record<string, unknown>>,
): Promise<unknown> => {
  const target = plugin(pluginName)
  if (target === null) {
    throw platformError("PLUGIN_UNAVAILABLE", `The ${pluginName} plugin is not available.`)
  }
  const fn = target[method]
  if (typeof fn !== "function") {
    throw platformError(
      "PLUGIN_UNAVAILABLE",
      `${pluginName}.${method} is not available in this build.`,
    )
  }
  return (fn as PluginCall).call(target, options)
}

export const tryCallPlugin = async (
  pluginName: string,
  method: string,
  options?: Readonly<Record<string, unknown>>,
): Promise<unknown> => {
  try {
    return await callPlugin(pluginName, method, options)
  } catch {
    return null
  }
}
