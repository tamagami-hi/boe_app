import { useEffect, useState } from "react"

import { canMatchMedia, mediaMatches, observeMedia } from "~/lib/media"

export const BREAKPOINTS = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1440,
} as const

export type Breakpoint = keyof typeof BREAKPOINTS

const ORDER: readonly Breakpoint[] = ["xl", "lg", "md", "sm"]

const queryFor = (name: Breakpoint): string => `(min-width: ${String(BREAKPOINTS[name])}px)`

const resolve = (): Breakpoint => {
  if (!canMatchMedia()) return "lg"
  for (const name of ORDER) {
    if (mediaMatches(queryFor(name))) return name
  }
  return "sm"
}

export const useBreakpoint = (): Breakpoint => {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(resolve)

  useEffect(() => {
    const update = (): void => {
      setBreakpoint(resolve())
    }
    update()
    return observeMedia(ORDER.map(queryFor), update) ?? undefined
  }, [])

  return breakpoint
}

export const isCompact = (breakpoint: Breakpoint): boolean =>
  breakpoint === "sm" || breakpoint === "md"
