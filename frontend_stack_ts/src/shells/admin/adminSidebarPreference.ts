import { useState } from "react"

const STORAGE_KEY = "boe.admin.sidebar"
const HIDDEN_VALUE = "hidden"
const SHOWN_VALUE = "shown"

const readSidebarShown = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== HIDDEN_VALUE
  } catch {
    return true
  }
}

const writeSidebarShown = (isShown: boolean): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, isShown ? SHOWN_VALUE : HIDDEN_VALUE)
  } catch {
    void 0
  }
}

export const useAdminSidebarShown = (): readonly [boolean, () => void] => {
  const [isShown, setShown] = useState(readSidebarShown)
  const toggle = (): void => {
    const next = !isShown
    setShown(next)
    writeSidebarShown(next)
  }
  return [isShown, toggle]
}
