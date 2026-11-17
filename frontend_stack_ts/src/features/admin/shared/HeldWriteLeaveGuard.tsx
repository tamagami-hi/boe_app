import { useCallback, useEffect, useRef } from "react"
import { useBlocker } from "react-router-dom"
import type { BlockerFunction } from "react-router-dom"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { findRoute } from "~/app/routing/routeManifest"

import { unsettledHeldWriteKeeping, useUnsettledHeldWriteKeeping } from "./unsettledHeldWrites"

const KEPT_ON_DEVICE =
  "A save is not confirmed yet. Leaving keeps it saved on this device, and you can come back to it later."
const KEPT_ON_PAGE =
  "A save is not confirmed yet, and it is kept on this page only. If you leave, it cannot be checked again, so check the record before you enter it again."

const isOpenPath = (pathname: string): boolean => findRoute(ADMIN_ROUTES, pathname)?.access === "public"

export const HeldWriteLeaveGuard = (): React.ReactElement => {
  const { status } = useSession()
  const keeping = useUnsettledHeldWriteKeeping()
  const isSignedIn = useRef(false)
  isSignedIn.current = status === "authenticated"
  const isGuarding = isSignedIn.current && keeping !== "none"

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      isSignedIn.current &&
      unsettledHeldWriteKeeping() !== "none" &&
      nextLocation.pathname !== currentLocation.pathname &&
      !isOpenPath(nextLocation.pathname),
    [],
  )
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    if (blocker.state === "blocked" && !isGuarding) blocker.reset()
  }, [blocker, isGuarding])

  return (
    <ConfirmDialog
      open={blocker.state === "blocked" && isGuarding}
      title="Stay on this page?"
      description={keeping === "page" ? KEPT_ON_PAGE : KEPT_ON_DEVICE}
      confirmLabel="Leave anyway"
      confirmTone="danger"
      cancelLabel="Stay"
      onConfirm={() => {
        blocker.proceed?.()
      }}
      onCancel={() => {
        blocker.reset?.()
      }}
    />
  )
}
