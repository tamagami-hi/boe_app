import { useEffect, useState } from "react"

export const BREAKPOINTS = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1440,
} as const

export type Breakpoint = keyof typeof BREAKPOINTS

const ORDER: readonly Breakpoint[] = ["xl", "lg", "md", "sm"]

const resolve = (): Breakpoint => {
  if (typeof window === "undefined") return "lg"
  for (const name of ORDER) {
    if (window.matchMedia(`(min-width: ${String(BREAKPOINTS[name])}px)`).matches) return name
  }
  return "sm"
}

export const useBreakpoint = (): Breakpoint => {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(resolve)

  useEffect(() => {
    if (typeof window === "undefined") return
    const queries = ORDER.map((name) =>
      window.matchMedia(`(min-width: ${String(BREAKPOINTS[name])}px)`),
    )
    const update = (): void => {
      setBreakpoint(resolve())
    }
    for (const query of queries) query.addEventListener("change", update)
    update()
    return () => {
      for (const query of queries) query.removeEventListener("change", update)
    }
  }, [])

  return breakpoint
}

export const isCompact = (breakpoint: Breakpoint): boolean =>
  breakpoint === "sm" || breakpoint === "md"
