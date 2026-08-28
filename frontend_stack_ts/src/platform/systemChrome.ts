import { isNative, tryCallPlugin } from "~/platform/capacitor"
import { platformError } from "~/platform/errors"

export const SYSTEM_BAR_STYLES = ["LIGHT", "DARK"] as const

export type SystemBarStyle = (typeof SYSTEM_BAR_STYLES)[number]

export const DEFAULT_BAR_BACKGROUND = "#F7F7F5"

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

const stack: SystemChrome[] = []
const subscribers = new Set<(chrome: SystemChrome) => void>()

export const getSystemChrome = (): SystemChrome => stack.at(-1) ?? DEFAULT_CHROME

const notify = (): void => {
  const chrome = getSystemChrome()
  for (const subscriber of subscribers) subscriber(chrome)
}

export const pushSystemChrome = (chrome: SystemChrome): (() => void) => {
  assertValidChrome(chrome)
  stack.push(chrome)
  notify()
  let popped = false
  return () => {
    if (popped) return
    popped = true
    const index = stack.lastIndexOf(chrome)
    if (index >= 0) stack.splice(index, 1)
    notify()
  }
}

export const subscribeToSystemChrome = (
  subscriber: (chrome: SystemChrome) => void,
): (() => void) => {
  subscribers.add(subscriber)
  subscriber(getSystemChrome())
  return () => {
    subscribers.delete(subscriber)
  }
}

export const applySystemChrome = async (chrome: SystemChrome): Promise<void> => {
  assertValidChrome(chrome)
  if (!isNative()) return
  await tryCallPlugin("SystemBars", "setStyle", { style: chrome.style })
  await tryCallPlugin("SystemChrome", "setBarBackground", { color: chrome.background })
}
