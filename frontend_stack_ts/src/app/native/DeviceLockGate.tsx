import { useEffect, useRef, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"

import {
  isDeviceLocked,
  isNativePromptInFlight,
  lockDevice,
  readDeviceLeftAt,
  recordDeviceLeft,
  subscribeToDeviceLock,
  unlockDevice,
} from "~/app/native/deviceLock"
import { LockScreen } from "~/features/device-security/LockScreen"
import { shouldLock } from "~/features/device-security/lockDecision"
import type { LockTrigger } from "~/features/device-security/lockDecision"
import {
  browserDeviceSecurityStore,
  hasDevicePin,
} from "~/features/device-security/securityStore"
import { isNative } from "~/platform/capacitor"
import { onAppStateChange } from "~/platform/lifecycle"

export const useDeviceLocked = (): boolean =>
  useSyncExternalStore(subscribeToDeviceLock, isDeviceLocked, () => false)

const evaluate = (trigger: LockTrigger): void => {
  const enrolled = hasDevicePin(browserDeviceSecurityStore())
  if (
    shouldLock({
      native: isNative(),
      enrolled,
      trigger,
      leftAt: readDeviceLeftAt(),
      now: Date.now(),
    })
  ) {
    lockDevice()
  }
}

const APP_ROOT_SELECTOR = "#root"

export type DeviceLockGateProps = Readonly<{ children: ReactNode }>

export const DeviceLockGate = ({ children }: DeviceLockGateProps): React.ReactElement => {
  const locked = useDeviceLocked()
  const lockPanel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!locked) return undefined
    const root = document.querySelector(APP_ROOT_SELECTOR)
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    root?.setAttribute("inert", "")
    lockPanel.current?.focus()
    return () => {
      root?.removeAttribute("inert")
      if (previous?.isConnected === true) previous.focus()
    }
  }, [locked])

  useEffect(() => {
    evaluate("cold-start")
  }, [])

  useEffect(
    () =>
      onAppStateChange((active) => {
        if (isNativePromptInFlight()) return
        if (!active) {
          recordDeviceLeft(Date.now())
          return
        }
        evaluate("resume")
      }),
    [],
  )

  return (
    <>
      {children}
      {locked ? createPortal(<LockScreen ref={lockPanel} onUnlocked={unlockDevice} />, document.body) : null}
    </>
  )
}
