import { useEffect, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"

import { cx } from "~/lib/cx"
import { mediaMatches } from "~/lib/media"

export type RevealProps = Readonly<{
  delayMs?: number
  className?: string
  children: ReactNode
}>

const prefersReducedMotion = (): boolean => mediaMatches("(prefers-reduced-motion: reduce)")

export const Reveal = ({ delayMs = 0, className, children }: RevealProps): React.ReactElement => {
  const node = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(prefersReducedMotion)

  useEffect(() => {
    if (shown) return
    const element = node.current
    if (element === null) return
    if (typeof IntersectionObserver === "undefined") {
      setShown(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [shown])

  const style =
    delayMs === 0 ? undefined : ({ "--be-reveal-delay": `${String(delayMs)}ms` } as CSSProperties)

  return (
    <div ref={node} className={cx("be-reveal", className)} data-shown={shown} style={style}>
      {children}
    </div>
  )
}
