import { isAndroid } from "~/platform/capacitor"
import { isEditableControl } from "~/platform/keyboardReveal"

const KEYBOARD_EVENT = "be:keyboard"

const KEYBOARD_HEIGHT_PROPERTY = "--be-keyboard-height"

const ZOOM_TOLERANCE = 0.01

export type KeyboardHeightListener = (height: number) => void

type VirtualKeyboardLike = EventTarget & {
  overlaysContent: boolean
  readonly boundingRect: DOMRectReadOnly
}

const stopNothing = (): void => undefined

const toHeight = (value: number): number => Math.max(0, Math.round(value))

const publish = (height: number): void => {
  const value = `${String(height)}px`
  const style = document.documentElement.style
  if (style.getPropertyValue(KEYBOARD_HEIGHT_PROPERTY) !== value) {
    style.setProperty(KEYBOARD_HEIGHT_PROPERTY, value)
  }
}

const unpublish = (): void => {
  document.documentElement.style.removeProperty(KEYBOARD_HEIGHT_PROPERTY)
}

const eventHeight = (event: Event): number | null => {
  if (!(event instanceof CustomEvent)) return null
  const detail: unknown = event.detail
  if (typeof detail !== "object" || detail === null) return null
  const height: unknown = (detail as { height?: unknown }).height
  return typeof height === "number" && Number.isFinite(height) ? toHeight(height) : null
}

const watchNativeEvent = (onHeight: KeyboardHeightListener): (() => void) => {
  const listener = (event: Event): void => {
    const height = eventHeight(event)
    if (height !== null) onHeight(height)
  }
  window.addEventListener(KEYBOARD_EVENT, listener)
  return () => {
    window.removeEventListener(KEYBOARD_EVENT, listener)
  }
}

const virtualKeyboardOf = (): VirtualKeyboardLike | null =>
  (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard ?? null

const watchVirtualKeyboard = (
  keyboard: VirtualKeyboardLike,
  onHeight: KeyboardHeightListener,
): (() => void) => {
  const overlaid = keyboard.overlaysContent
  keyboard.overlaysContent = true
  const listener = (): void => {
    const height = toHeight(keyboard.boundingRect.height)
    publish(height)
    onHeight(height)
  }
  keyboard.addEventListener("geometrychange", listener)
  return () => {
    keyboard.removeEventListener("geometrychange", listener)
    keyboard.overlaysContent = overlaid
    unpublish()
  }
}

const hiddenBelow = (viewport: VisualViewport): number => {
  if (Math.abs(viewport.scale - 1) > ZOOM_TOLERANCE) return 0
  if (!isEditableControl(document.activeElement)) return 0
  return toHeight(window.innerHeight - viewport.height - viewport.offsetTop)
}

const watchVisualViewport = (
  viewport: VisualViewport,
  onHeight: KeyboardHeightListener,
): (() => void) => {
  const listener = (): void => {
    const height = hiddenBelow(viewport)
    publish(height)
    onHeight(height)
  }
  viewport.addEventListener("resize", listener)
  viewport.addEventListener("scroll", listener)
  return () => {
    viewport.removeEventListener("resize", listener)
    viewport.removeEventListener("scroll", listener)
    unpublish()
  }
}

export const watchKeyboardHeight = (onHeight: KeyboardHeightListener): (() => void) => {
  if (typeof window === "undefined") return stopNothing
  if (isAndroid()) return watchNativeEvent(onHeight)

  const keyboard = virtualKeyboardOf()
  if (keyboard !== null) return watchVirtualKeyboard(keyboard, onHeight)

  const viewport: VisualViewport | null | undefined = window.visualViewport
  if (viewport != null) return watchVisualViewport(viewport, onHeight)

  return stopNothing
}
