import { useEffect, useSyncExternalStore } from "react"
import type { ReactNode } from "react"

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

export type DeviceLockGateProps = Readonly<{ children: ReactNode }>

export const DeviceLockGate = ({ children }: DeviceLockGateProps): React.ReactElement => {
  const locked = useDeviceLocked()

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
      {locked ? <LockScreen onUnlocked={unlockDevice} /> : null}
    </>
  )
}
