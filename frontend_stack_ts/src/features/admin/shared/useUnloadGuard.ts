import { useEffect } from "react"

const refuseUnload = (event: BeforeUnloadEvent): void => {
  event.preventDefault()
}

export const useUnloadGuard = (isActive: boolean): void => {
  useEffect(() => {
    if (!isActive) return undefined
    window.addEventListener("beforeunload", refuseUnload)
    return () => {
      window.removeEventListener("beforeunload", refuseUnload)
    }
  }, [isActive])
}
