import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { useOverlayStack } from "~/app/providers/OverlayStackProvider"
import { onHardwareBack } from "~/platform/lifecycle"
import { tryCallPlugin } from "~/platform/capacitor"
import type { BackPolicyResolver } from "~/app/native/backPolicy"

export type TransactionalBackHandler = (input: Readonly<{ pathname: string }>) => boolean

export type NativeBackCoordinatorProps = Readonly<{
  resolvePolicy: BackPolicyResolver
  onTransactionalBack?: TransactionalBackHandler
}>

export const NativeBackCoordinator = ({
  resolvePolicy,
  onTransactionalBack,
}: NativeBackCoordinatorProps): null => {
  const navigate = useNavigate()
  const location = useLocation()
  const overlays = useOverlayStack()

  const state = useRef({
    pathname: location.pathname,
    resolvePolicy,
    onTransactionalBack,
    dismissTop: overlays.dismissTop,
    navigate,
  })

  state.current = {
    pathname: location.pathname,
    resolvePolicy,
    onTransactionalBack,
    dismissTop: overlays.dismissTop,
    navigate,
  }

  useEffect(
    () =>
      onHardwareBack((canGoBack) => {
        const current = state.current

        if (current.dismissTop()) return

        const policy = current.resolvePolicy({ pathname: current.pathname })

        if (policy.isTransactional && current.onTransactionalBack !== undefined) {
          const handled = current.onTransactionalBack({ pathname: current.pathname })
          if (handled) return
        }

        if (policy.parentPath !== null) {
          void current.navigate(policy.parentPath, { replace: true })
          return
        }

        if (policy.isPrimary && !policy.isHome) {
          void current.navigate(policy.homePath, { replace: true })
          return
        }

        if (policy.isHome || policy.isPublic) {
          if (canGoBack) {
            void current.navigate(-1)
            return
          }
          void tryCallPlugin("App", "exitApp")
          return
        }

        if (canGoBack) {
          void current.navigate(-1)
          return
        }

        void current.navigate(policy.homePath, { replace: true })
      }),
    [],
  )

  return null
}
