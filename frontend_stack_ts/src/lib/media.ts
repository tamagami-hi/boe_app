type MediaQueryFactory = (query: string) => MediaQueryList

const factory = (): MediaQueryFactory | null => {
  const candidate = (globalThis as { matchMedia?: unknown }).matchMedia
  return typeof candidate === "function"
    ? (candidate as MediaQueryFactory).bind(globalThis)
    : null
}

export const canMatchMedia = (): boolean => factory() !== null

export const mediaMatches = (query: string): boolean => {
  const match = factory()
  return match === null ? false : match(query).matches
}

export const observeMedia = (
  queries: readonly string[],
  onChange: () => void,
): (() => void) | null => {
  const match = factory()
  if (match === null) return null

  const lists = queries.map((query) => match(query))
  for (const list of lists) list.addEventListener("change", onChange)
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange)
  }
}
