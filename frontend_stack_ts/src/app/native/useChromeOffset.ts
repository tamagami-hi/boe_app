import { useLayoutEffect } from "react"
import type { RefObject } from "react"

const CHROME_OFFSET = "--be-chrome-offset"
const CHROME_SAFE_TOP = "--be-chrome-safe-top"

export const useChromeOffset = (banner: RefObject<HTMLDivElement | null>, active: boolean): void => {
  useLayoutEffect(() => {
    const node = banner.current
    if (!active || node === null) return

    const root = document.documentElement
    const publish = (): void => {
      const height = node.getBoundingClientRect().height
      root.style.setProperty(CHROME_OFFSET, `${String(Math.round(height * 10) / 10)}px`)
      root.style.setProperty(CHROME_SAFE_TOP, "0px")
    }

    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(node)

    return () => {
      observer.disconnect()
      root.style.removeProperty(CHROME_OFFSET)
      root.style.removeProperty(CHROME_SAFE_TOP)
    }
  }, [banner, active])
}
