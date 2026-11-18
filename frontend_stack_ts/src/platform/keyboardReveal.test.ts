import { describe, expect, it } from "vitest"

import { planReveal, topInset } from "~/platform/keyboardReveal"
import type { Box, RevealInput, ScrollBox } from "~/platform/keyboardReveal"

const VIEWPORT_HEIGHT = 800
const STATUS_BAR = 24
const KEYBOARD_HEIGHT = 300
const TOP_BAR_BOTTOM = 80

const revealInput = (overrides: Partial<RevealInput> = {}): RevealInput => ({
  field: { top: 600, bottom: 648 },
  hints: [],
  trailing: [],
  ancestors: [],
  viewportHeight: VIEWPORT_HEIGHT,
  keyboardHeight: KEYBOARD_HEIGHT,
  topBarBottom: TOP_BAR_BOTTOM,
  canScrollDocument: true,
  ...overrides,
})

const formCard: ScrollBox = {
  overflowY: "visible",
  scrollTop: 0,
  scrollHeight: 400,
  clientHeight: 400,
  span: { top: 300, bottom: 700 },
}

const tableWrapper: ScrollBox = {
  overflowY: "auto",
  scrollTop: 0,
  scrollHeight: 240,
  clientHeight: 240,
  span: { top: 560, bottom: 800 },
}

const clippedShell: ScrollBox = {
  overflowY: "auto",
  scrollTop: 0,
  scrollHeight: 902,
  clientHeight: 900,
  span: { top: 0, bottom: 900 },
}

const sheetPanel: ScrollBox = {
  overflowY: "auto",
  scrollTop: 200,
  scrollHeight: 1100,
  clientHeight: 700,
  span: { top: 100, bottom: 800 },
}

describe("planReveal", () => {
  it("never scrolls while no keyboard is shown, even for a field below the fold", () => {
    expect(planReveal(revealInput({ keyboardHeight: 0 }))).toBeNull()
    expect(planReveal(revealInput({ keyboardHeight: 0, field: { top: 900, bottom: 948 } }))).toBeNull()
  })

  it("lifts a covered field until its bottom sits 16 px above the keyboard", () => {
    expect(planReveal(revealInput())).toEqual({ scroller: "document", delta: 164 })
  })

  it("leaves a field that already clears the keyboard by the margin", () => {
    expect(planReveal(revealInput({ field: { top: 420, bottom: 484 } }))).toBeNull()
  })

  it("moves a field that is visible but inside the margin by the missing pixels only", () => {
    expect(planReveal(revealInput({ field: { top: 440, bottom: 492 } }))).toEqual({
      scroller: "document",
      delta: 8,
    })
  })

  it("makes room for the hint or error line under the field and ignores text elsewhere", () => {
    const hints = [
      { top: 652, bottom: 670 },
      { top: 120, bottom: 140 },
      { top: 760, bottom: 780 },
    ]
    expect(planReveal(revealInput({ hints }))).toEqual({ scroller: "document", delta: 186 })
  })

  it("reveals the form's submit button with its last field when both fit above the keyboard", () => {
    expect(planReveal(revealInput({ trailing: [{ top: 700, bottom: 748 }] }))).toEqual({
      scroller: "document",
      delta: 264,
    })
  })

  it("reveals the last field alone when it and the submit button do not fit together", () => {
    expect(planReveal(revealInput({ trailing: [{ top: 1000, bottom: 1048 }] }))).toEqual({
      scroller: "document",
      delta: 164,
    })
  })

  it("brings a field hidden under the top bar down to 16 px below it", () => {
    expect(planReveal(revealInput({ field: { top: 40, bottom: 88 } }))).toEqual({
      scroller: "document",
      delta: -56,
    })
  })

  it("keeps the top of a field taller than the visible space in view", () => {
    expect(planReveal(revealInput({ field: { top: 200, bottom: 900 } }))).toEqual({
      scroller: "document",
      delta: 104,
    })
  })

  it("scrolls the nearest ancestor that can scroll, such as a sheet panel", () => {
    const ancestors = [formCard, sheetPanel]
    expect(planReveal(revealInput({ ancestors, topBarBottom: 0 }))).toEqual({
      scroller: 1,
      delta: 164,
    })
  })

  it("skips an overflow ancestor with nothing to scroll and falls back to the document", () => {
    const ancestors = [tableWrapper, formCard]
    expect(planReveal(revealInput({ ancestors }))).toEqual({ scroller: "document", delta: 164 })
  })

  it("passes a scroller without enough room on to the document", () => {
    const ancestors = [clippedShell]
    expect(planReveal(revealInput({ ancestors }))).toEqual({ scroller: "document", delta: 164 })
  })

  it("brings a field above the top of its sheet back inside the sheet", () => {
    const ancestors = [sheetPanel]
    const field = { top: 60, bottom: 108 }
    expect(planReveal(revealInput({ ancestors, field, topBarBottom: 0 }))).toEqual({
      scroller: 0,
      delta: -56,
    })
  })

  it("never scrolls the page behind an overlay", () => {
    expect(planReveal(revealInput({ canScrollDocument: false }))).toBeNull()
    const cramped = { ...sheetPanel, scrollTop: 0, scrollHeight: 760 }
    expect(planReveal(revealInput({ ancestors: [cramped], topBarBottom: 0, canScrollDocument: false }))).toEqual({
      scroller: 0,
      delta: 164,
    })
  })
})

describe("topInset", () => {
  it("counts pinned bars above the field and ignores the sidebar beside it and the bottom nav", () => {
    const field: Box = { top: 600, bottom: 648, left: 300, right: 900 }
    const bars: Box[] = [
      { top: 0, bottom: 40, left: 0, right: 1280 },
      { top: 40, bottom: 112, left: 0, right: 1280 },
      { top: 24, bottom: 360, left: 24, right: 264 },
      { top: 744, bottom: 800, left: 0, right: 1280 },
      { top: 0, bottom: 0, left: 0, right: 1280 },
    ]
    expect(topInset(bars, field, VIEWPORT_HEIGHT, STATUS_BAR)).toBe(112)
  })

  it("keeps the status bar as the floor on a page with no top bar", () => {
    const field: Box = { top: 10, bottom: 58, left: 0, right: 400 }
    expect(topInset([], field, VIEWPORT_HEIGHT, STATUS_BAR)).toBe(24)
  })
})
