import { isNative, tryCallPlugin } from "~/platform/capacitor"
import { platformError } from "~/platform/errors"

export const SYSTEM_BAR_STYLES = ["LIGHT", "DARK"] as const

export type SystemBarStyle = (typeof SYSTEM_BAR_STYLES)[number]

export const DEFAULT_BAR_BACKGROUND = "#F4F1E9"

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u

export type SystemChrome = Readonly<{
  style: SystemBarStyle
  background: string
}>

const DEFAULT_CHROME: SystemChrome = {
  style: "LIGHT",
  background: DEFAULT_BAR_BACKGROUND,
}

const assertValidChrome = (chrome: SystemChrome): void => {
  if (!SYSTEM_BAR_STYLES.includes(chrome.style)) {
    throw platformError("INVALID_ARGUMENT", `Unknown system bar style: ${chrome.style}`)
  }
  if (!HEX_COLOUR.test(chrome.background)) {
    throw platformError(
      "INVALID_ARGUMENT",
      `System bar background must be a hex colour, received ${chrome.background}`,
    )
  }
}

export const getSystemChrome = (): SystemChrome => DEFAULT_CHROME

export const applySystemChrome = async (chrome: SystemChrome): Promise<void> => {
  assertValidChrome(chrome)
  if (!isNative()) return
  await tryCallPlugin("SystemBars", "setStyle", { style: chrome.style })
  await tryCallPlugin("SystemChrome", "setBarBackground", { color: chrome.background })
}
