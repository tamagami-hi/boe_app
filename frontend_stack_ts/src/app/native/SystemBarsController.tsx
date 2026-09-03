import { useEffect } from "react"

import { onResume } from "~/platform/lifecycle"
import { applySystemChrome, getSystemChrome } from "~/platform/systemChrome"

export const SystemBarsController = (): null => {
  useEffect(() => {
    void applySystemChrome(getSystemChrome())
  }, [])

  useEffect(
    () =>
      onResume(() => {
        void applySystemChrome(getSystemChrome())
      }),
    [],
  )

  return null
}
