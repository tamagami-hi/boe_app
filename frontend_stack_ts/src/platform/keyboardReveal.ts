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
  trailing: readonly Span[]
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

export const topInset = (
  bars: readonly Box[],
  field: Box,
  viewportHeight: number,
  safeTop: number,
): number =>
  bars
    .filter(
      (bar) =>
        bar.bottom > bar.top &&
        bar.bottom <= viewportHeight / 2 &&
        bar.left < field.right &&
        bar.right > field.left,
    )
    .reduce((bottom, bar) => Math.max(bottom, bar.bottom), Math.max(0, safeTop))

type Target = Readonly<{ field: Span; extended: Span }>

const reaching = (field: Span, spans: readonly Span[], reach: number): Span => ({
  top: field.top,
  bottom: spans
    .filter((span) => span.top >= field.top && span.top - field.bottom <= reach)
    .reduce((bottom, span) => Math.max(bottom, span.bottom), field.bottom),
})

const targetOf = (input: RevealInput): Target => {
  const field = reaching(input.field, input.hints, HINT_REACH)
  return { field, extended: reaching(field, input.trailing, Number.POSITIVE_INFINITY) }
}

const heightOf = (span: Span): number => span.bottom - span.top

const roundAway = (value: number): number => (value > 0 ? Math.ceil(value) : Math.floor(value))

const deltaWithin = (target: Target, visible: Span): number | null => {
  const top = visible.top + KEYBOARD_FIELD_MARGIN
  const bottom = visible.bottom - KEYBOARD_FIELD_MARGIN
  if (bottom <= top) return null
  const span = heightOf(target.extended) <= bottom - top ? target.extended : target.field
  if (span.bottom > bottom) return roundAway(Math.min(span.bottom - bottom, span.top - top))
  if (span.top < visible.top) return roundAway(span.top - top)
  return 0
}

const hasRoom = (box: ScrollBox, delta: number): boolean =>
  delta >= -box.scrollTop - SCROLL_TOLERANCE &&
  delta <= box.scrollHeight - box.clientHeight - box.scrollTop + SCROLL_TOLERANCE

type Candidate = Readonly<{ index: number; delta: number; fits: boolean }>

const candidatesOf = (input: RevealInput, target: Target, keyboardTop: number): readonly Candidate[] =>
  input.ancestors.flatMap((box, index) => {
    if (!isScrollBox(box)) return []
    const delta = deltaWithin(target, {
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
  const target = targetOf(input)
  const candidates = candidatesOf(input, target, keyboardTop)
  const nearest = candidates[0]
  if (nearest?.delta === 0) return null

  const fitting = candidates.find((candidate) => candidate.fits)
  if (fitting !== undefined) return planOf(fitting.index, fitting.delta)

  if (input.canScrollDocument) {
    const delta = deltaWithin(target, { top: input.topBarBottom, bottom: keyboardTop })
    return delta === null ? null : planOf("document", delta)
  }
  return nearest === undefined ? null : planOf(nearest.index, nearest.delta)
}
