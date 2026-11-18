import { useEffect } from "react"

import { mediaMatches } from "~/lib/media"
import { watchKeyboardHeight } from "~/platform/keyboardHeight"
import { isEditableControl, planReveal, topInset } from "~/platform/keyboardReveal"
import type { Box, RevealPlan, ScrollBox, Span } from "~/platform/keyboardReveal"

const TOP_BAR_SELECTOR = "header, nav, [role='status']"
const OVERLAY_SELECTOR = "[aria-modal='true']"
const PINNED_POSITIONS: ReadonlySet<string> = new Set(["fixed", "sticky"])
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"
const SAFE_TOP_PROBE =
  "position:fixed;top:0;left:0;width:0;height:var(--be-safe-top);visibility:hidden;pointer-events:none"

const boxOf = (node: Element): Box => {
  const rect = node.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
}

const spanOf = (node: Element): Span => {
  const rect = node.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom }
}

const isShown = (node: Element): boolean => node.getClientRects().length > 0

const describedSpans = (control: HTMLElement): readonly Span[] =>
  (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/u)
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id))
    .filter((node): node is HTMLElement => node !== null)
    .map(spanOf)
    .filter((span) => span.bottom > span.top)

const isSubmitControl = (node: Element): boolean =>
  (node instanceof HTMLButtonElement || node instanceof HTMLInputElement) && node.type === "submit"

const submitSpans = (control: HTMLElement): readonly Span[] => {
  const form = control.closest("form")
  if (form === null) return []
  const shown = [...form.elements].filter(isShown)
  const editable = shown.filter((node) => isEditableControl(node) && !node.matches(":disabled"))
  if (editable.at(-1) !== control) return []
  return shown.filter(isSubmitControl).map(spanOf)
}

const ancestorsOf = (node: HTMLElement): readonly HTMLElement[] => {
  const parent = node.parentElement
  if (parent === null || parent === document.body || parent === document.documentElement) return []
  return [parent, ...ancestorsOf(parent)]
}

const scrollBoxOf = (node: HTMLElement): ScrollBox => ({
  overflowY: getComputedStyle(node).overflowY,
  scrollTop: node.scrollTop,
  scrollHeight: node.scrollHeight,
  clientHeight: node.clientHeight,
  span: spanOf(node),
})

const safeTop = (): number => {
  const probe = document.createElement("div")
  probe.setAttribute("aria-hidden", "true")
  probe.style.cssText = SAFE_TOP_PROBE
  document.body.append(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  return height
}

const pinnedBars = (control: HTMLElement): readonly Box[] =>
  [...document.querySelectorAll(TOP_BAR_SELECTOR)]
    .filter((bar) => !bar.contains(control) && PINNED_POSITIONS.has(getComputedStyle(bar).position))
    .map(boxOf)

const runningAnimations = (node: Element): readonly Animation[] =>
  "getAnimations" in node
    ? node.getAnimations().filter((animation) => animation.playState === "running")
    : []

const scrollBehavior = (): ScrollBehavior => (mediaMatches(REDUCED_MOTION) ? "auto" : "smooth")

const applyPlan = (plan: RevealPlan, ancestors: readonly HTMLElement[]): void => {
  const behavior = scrollBehavior()
  if (plan.scroller === "document") {
    window.scrollTo({ top: window.scrollY + plan.delta, behavior })
    return
  }
  const target = ancestors[plan.scroller]
  target?.scrollTo({ top: target.scrollTop + plan.delta, behavior })
}

const revealFocusedControl = (keyboardHeight: number, retry: () => void): void => {
  const control = document.activeElement
  if (!isEditableControl(control)) return

  const overlay = control.closest(OVERLAY_SELECTOR)
  const moving = overlay === null ? [] : runningAnimations(overlay)
  if (moving.length > 0) {
    void Promise.allSettled(moving.map((animation) => animation.finished)).then(() => {
      retry()
    })
    return
  }

  const viewportHeight = window.innerHeight
  const ancestors = ancestorsOf(control)
  const plan = planReveal({
    field: spanOf(control),
    hints: describedSpans(control),
    trailing: submitSpans(control),
    ancestors: ancestors.map(scrollBoxOf),
    viewportHeight,
    keyboardHeight,
    topBarBottom: topInset(overlay === null ? pinnedBars(control) : [], boxOf(control), viewportHeight, safeTop()),
    canScrollDocument: overlay === null,
  })
  if (plan !== null) applyPlan(plan, ancestors)
}

export const KeyboardAvoidance = (): null => {
  useEffect(() => {
    let keyboardHeight = 0
    let frame: number | null = null
    let isDisposed = false

    const schedule = (): void => {
      if (frame !== null || isDisposed) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        revealFocusedControl(keyboardHeight, schedule)
      })
    }

    const stopWatching = watchKeyboardHeight((height) => {
      if (height === keyboardHeight) return
      keyboardHeight = height
      if (height > 0) schedule()
    })

    const onFocusIn = (): void => {
      if (keyboardHeight > 0) schedule()
    }
    document.addEventListener("focusin", onFocusIn)

    return () => {
      isDisposed = true
      stopWatching()
      document.removeEventListener("focusin", onFocusIn)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [])

  return null
}
