import { useCallback, useEffect, useRef } from "react"
import { useBlocker } from "react-router-dom"
import type { BlockerFunction } from "react-router-dom"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { findRoute } from "~/app/routing/routeManifest"

import { heldWriteKeepingOnLeave, useHeldWriteKeepingOnLeave } from "./unsettledHeldWrites"

export const LEAVE_HELD_WRITE: Readonly<{ leaveHeldWrite: true }> = { leaveHeldWrite: true }

const KEPT_IN_TAB =
  "A save is not confirmed yet. Leaving keeps it in this tab, and you can come back to this page to check it."
const KEPT_ON_PAGE =
  "A save is not confirmed yet, and it is kept on this page only. If you leave, it cannot be checked again, so check the record before you enter it again."

const isOpenPath = (pathname: string): boolean => findRoute(ADMIN_ROUTES, pathname)?.access === "public"

const isLeavingOnPurpose = (state: unknown): boolean =>
  typeof state === "object" && state !== null && (state as Readonly<Record<string, unknown>>).leaveHeldWrite === true

export const HeldWriteLeaveGuard = (): React.ReactElement => {
  const { status } = useSession()
  const keeping = useHeldWriteKeepingOnLeave()
  const isSignedInNow = status === "authenticated"
  const isSignedIn = useRef(false)
  isSignedIn.current = isSignedInNow

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      isSignedIn.current &&
      heldWriteKeepingOnLeave() !== "none" &&
      nextLocation.pathname !== currentLocation.pathname &&
      !isOpenPath(nextLocation.pathname) &&
      !isLeavingOnPurpose(nextLocation.state),
    [],
  )
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    if (blocker.state !== "blocked") return
    if (!isSignedInNow) blocker.reset()
    else if (keeping === "none") blocker.proceed()
  }, [blocker, isSignedInNow, keeping])

  return (
    <ConfirmDialog
      open={blocker.state === "blocked" && isSignedInNow && keeping !== "none"}
      title="Stay on this page?"
      description={keeping === "page" ? KEPT_ON_PAGE : KEPT_IN_TAB}
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
