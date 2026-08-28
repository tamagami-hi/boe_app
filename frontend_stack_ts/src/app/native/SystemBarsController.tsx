import { useEffect } from "react"

import { onResume } from "~/platform/lifecycle"
import { applySystemChrome, getSystemChrome, subscribeToSystemChrome } from "~/platform/systemChrome"

export const SystemBarsController = (): null => {
  useEffect(
    () =>
      subscribeToSystemChrome((chrome) => {
        void applySystemChrome(chrome)
      }),
    [],
  )

  useEffect(
    () =>
      onResume(() => {
        void applySystemChrome(getSystemChrome())
      }),
    [],
  )

  return null
}
