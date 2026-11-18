import { useEffect } from "react"

import { mediaMatches } from "~/lib/media"
import { watchKeyboardHeight } from "~/platform/keyboardHeight"
import { isEditableControl, planReveal, topInset } from "~/platform/keyboardReveal"
import type { Box, RevealPlan, ScrollBox, Span } from "~/platform/keyboardReveal"

const TOP_BAR_SELECTOR = "header, nav, [role='status']"
const OVERLAY_SELECTOR = "[aria-modal='true']"
const PINNED_POSITIONS: ReadonlySet<string> = new Set(["fixed", "sticky"])
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

const boxOf = (node: Element): Box => {
  const rect = node.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
}

const spanOf = (node: Element): Span => {
  const rect = node.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom }
}

const describedSpans = (control: HTMLElement): readonly Span[] =>
  (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/u)
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id))
    .filter((node): node is HTMLElement => node !== null)
    .map(spanOf)
    .filter((span) => span.bottom > span.top)

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

const topBarBottom = (control: HTMLElement, viewportHeight: number): number => {
  const bars = [...document.querySelectorAll(TOP_BAR_SELECTOR)]
    .filter((bar) => !bar.contains(control) && PINNED_POSITIONS.has(getComputedStyle(bar).position))
    .map(boxOf)
  return topInset(bars, boxOf(control), viewportHeight)
}

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

const revealFocusedControl = (keyboardHeight: number): void => {
  const control = document.activeElement
  if (!isEditableControl(control)) return

  const viewportHeight = window.innerHeight
  const ancestors = ancestorsOf(control)
  const isInOverlay = control.closest(OVERLAY_SELECTOR) !== null
  const plan = planReveal({
    field: spanOf(control),
    hints: describedSpans(control),
    ancestors: ancestors.map(scrollBoxOf),
    viewportHeight,
    keyboardHeight,
    topBarBottom: isInOverlay ? 0 : topBarBottom(control, viewportHeight),
    canScrollDocument: !isInOverlay,
  })
  if (plan !== null) applyPlan(plan, ancestors)
}

export const KeyboardAvoidance = (): null => {
  useEffect(() => {
    let keyboardHeight = 0
    let frame: number | null = null

    const schedule = (): void => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        revealFocusedControl(keyboardHeight)
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
      stopWatching()
      document.removeEventListener("focusin", onFocusIn)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [])

  return null
}
