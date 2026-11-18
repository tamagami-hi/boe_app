const KEYBOARD_FIELD_MARGIN = 16

const HINT_REACH = 48

const SCROLL_TOLERANCE = 1

export type Span = Readonly<{ top: number; bottom: number }>

export type Box = Span & Readonly<{ left: number; right: number }>

export type ScrollBox = Readonly<{
  overflowY: string
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  span: Span
}>

export type RevealInput = Readonly<{
  field: Span
  hints: readonly Span[]
  ancestors: readonly ScrollBox[]
  viewportHeight: number
  keyboardHeight: number
  topBarBottom: number
  canScrollDocument: boolean
}>

export type RevealPlan = Readonly<{ scroller: number | "document"; delta: number }>

const SCROLLING_OVERFLOW: ReadonlySet<string> = new Set(["auto", "scroll", "overlay"])

const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "range",
  "file",
])

export const isEditableControl = (node: Element | null): node is HTMLElement => {
  if (!(node instanceof HTMLElement)) return false
  if (node instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(node.type)
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true
  return node.isContentEditable
}

const isScrollBox = (box: ScrollBox): boolean =>
  SCROLLING_OVERFLOW.has(box.overflowY) && box.scrollHeight - box.clientHeight > SCROLL_TOLERANCE

export const topInset = (bars: readonly Box[], field: Box, viewportHeight: number): number =>
  bars
    .filter(
      (bar) =>
        bar.bottom > bar.top &&
        bar.bottom <= viewportHeight / 2 &&
        bar.left < field.right &&
        bar.right > field.left,
    )
    .reduce((bottom, bar) => Math.max(bottom, bar.bottom), 0)

const withHints = (field: Span, hints: readonly Span[]): Span => ({
  top: field.top,
  bottom: hints
    .filter((hint) => hint.top >= field.top && hint.top - field.bottom <= HINT_REACH)
    .reduce((bottom, hint) => Math.max(bottom, hint.bottom), field.bottom),
})

const roundAway = (value: number): number => (value > 0 ? Math.ceil(value) : Math.floor(value))

const deltaWithin = (field: Span, visible: Span): number | null => {
  const top = visible.top + KEYBOARD_FIELD_MARGIN
  const bottom = visible.bottom - KEYBOARD_FIELD_MARGIN
  if (bottom <= top) return null
  if (field.bottom > bottom) return roundAway(Math.min(field.bottom - bottom, field.top - top))
  if (field.top < visible.top) return roundAway(field.top - top)
  return 0
}

const hasRoom = (box: ScrollBox, delta: number): boolean =>
  delta >= -box.scrollTop - SCROLL_TOLERANCE &&
  delta <= box.scrollHeight - box.clientHeight - box.scrollTop + SCROLL_TOLERANCE

type Candidate = Readonly<{ index: number; delta: number; fits: boolean }>

const candidatesOf = (input: RevealInput, field: Span, keyboardTop: number): readonly Candidate[] =>
  input.ancestors.flatMap((box, index) => {
    if (!isScrollBox(box)) return []
    const delta = deltaWithin(field, {
      top: Math.max(input.topBarBottom, box.span.top),
      bottom: Math.min(keyboardTop, box.span.bottom),
    })
    return delta === null ? [] : [{ index, delta, fits: hasRoom(box, delta) }]
  })

const planOf = (scroller: RevealPlan["scroller"], delta: number): RevealPlan | null =>
  delta === 0 ? null : { scroller, delta }

export const planReveal = (input: RevealInput): RevealPlan | null => {
  if (!(input.keyboardHeight > 0)) return null

  const keyboardTop = input.viewportHeight - input.keyboardHeight
  const field = withHints(input.field, input.hints)
  const candidates = candidatesOf(input, field, keyboardTop)
  const nearest = candidates[0]
  if (nearest?.delta === 0) return null

  const fitting = candidates.find((candidate) => candidate.fits)
  if (fitting !== undefined) return planOf(fitting.index, fitting.delta)

  if (input.canScrollDocument) {
    const delta = deltaWithin(field, { top: input.topBarBottom, bottom: keyboardTop })
    return delta === null ? null : planOf("document", delta)
  }
  return nearest === undefined ? null : planOf(nearest.index, nearest.delta)
}
