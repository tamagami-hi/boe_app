import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import { mediaMatches } from "~/lib/media"

import styles from "./Reveal.module.css"

export type RevealProps = Readonly<{
  delayMs?: number
  children: ReactNode
}>

const prefersReducedMotion = (): boolean => mediaMatches("(prefers-reduced-motion: reduce)")

export const Reveal = ({ delayMs = 0, children }: RevealProps): React.ReactElement => {
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

  return (
    <div
      ref={node}
      className={cx(styles.reveal, shown && styles.shown)}
      style={delayMs === 0 ? undefined : { transitionDelay: `${String(delayMs)}ms` }}
    >
      {children}
    </div>
  )
}
