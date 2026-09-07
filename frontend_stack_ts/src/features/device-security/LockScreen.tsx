import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useSession } from "~/app/providers/SessionProvider"
import { beginNativePrompt, endNativePrompt } from "~/app/native/deviceLock"
import { NO_BIOMETRIC, readBiometricCapability, verifyBiometric } from "~/platform/biometric"
import type { BiometricCapability } from "~/platform/biometric"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"
import { BLOCK_HEAD, BLOCK_LAYER, BLOCK_MARK, BLOCK_PANEL } from "~/ui/recipes/overlay"
import { CARD_TITLE, HONESTY_TEXT } from "~/ui/recipes/text"
import { GATE_TITLE } from "~/ui/recipes/layout"

import { PinPad } from "./PinPad"
import { DEVICE_PIN_HONESTY } from "./copy"
import {
  MIN_PIN_LENGTH,
  browserDeviceSecurityStore,
  isBiometricEnabled,
  removeDevicePin,
  verifyDevicePin,
} from "./securityStore"

const BIOMETRIC_MESSAGES: Readonly<Record<"cancelled" | "unavailable" | "failed", string>> = {
  cancelled: "Biometric unlock was cancelled. Enter your PIN instead.",
  unavailable: "Biometric unlock isn't available right now. Enter your PIN instead.",
  failed: "Biometric unlock didn't work. Enter your PIN instead.",
}

export const FORGOTTEN_PIN_CONSEQUENCE =
  "We will remove the PIN and sign you out on this device. Your account itself is unchanged \u2014 sign in again with your email and password."

export type LockScreenProps = Readonly<{ onUnlocked: () => void }>

export const LockScreen = ({ onUnlocked }: LockScreenProps): React.ReactElement => {
  const store = useMemo(browserDeviceSecurityStore, [])
  const session = useSession()
  const [entry, setEntry] = useState("")
  const [failure, setFailure] = useState<string | null>(null)
  const [capability, setCapability] = useState<BiometricCapability>(NO_BIOMETRIC)
  const [checking, setChecking] = useState(false)
  const [abandoning, setAbandoning] = useState(false)
  const biometricRequested = useRef(false)
  const unlock = useRef(onUnlocked)
  unlock.current = onUnlocked

  const biometricWanted = useMemo(() => isBiometricEnabled(store), [store])

  const attemptBiometric = useCallback(async (): Promise<void> => {
    setChecking(true)
    beginNativePrompt()
    try {
      const outcome = await verifyBiometric({
        title: "Unlock BeOnEdge",
        subtitle: "Confirm it is you",
        reason: "Unlock BeOnEdge on this device",
      })
      if (outcome.ok) {
        unlock.current()
        return
      }
      setFailure(BIOMETRIC_MESSAGES[outcome.reason])
    } catch {
      setFailure(BIOMETRIC_MESSAGES.unavailable)
    } finally {
      endNativePrompt()
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void readBiometricCapability().then((resolved) => {
      if (cancelled) return
      setCapability(resolved)
      if (!biometricWanted || !resolved.enrolled) return
      if (biometricRequested.current) return
      biometricRequested.current = true
      void attemptBiometric()
    })
    return () => {
      cancelled = true
    }
  }, [biometricWanted, attemptBiometric])

  const submit = (): void => {
    setFailure(null)
    void verifyDevicePin(store, entry).then((ok) => {
      if (!ok) {
        setEntry("")
        setFailure("That PIN is not correct.")
        return
      }
      setEntry("")
      unlock.current()
    })
  }

  const abandon = (): void => {
    removeDevicePin(store)
    session.signedOut()
    setAbandoning(false)
    unlock.current()
  }

  const biometricOffered = biometricWanted && capability.enrolled

  return (
    <div className={BLOCK_LAYER} role="dialog" aria-modal="true" aria-label="BeOnEdge is locked">
      <div className={BLOCK_PANEL}>
        <div className={BLOCK_HEAD}>
          <span className={BLOCK_MARK}>BeOnEdge</span>
          <h1 className={GATE_TITLE}>Locked</h1>
        </div>

        {failure === null ? null : (
          <Alert tone="error" title="Not unlocked">
            {failure}
          </Alert>
        )}

        <Card elevated>
          <div className={STACK_LG}>
            <PinPad prompt="Enter your device PIN" value={entry} onChange={setEntry} />
            <Button disabled={entry.length < MIN_PIN_LENGTH || checking} onClick={submit}>
              Unlock
            </Button>
            <div className={ACTION_ROW}>
              {biometricOffered ? (
                <Button
                  tone="secondary"
                  loading={checking}
                  onClick={() => {
                    setFailure(null)
                    void attemptBiometric()
                  }}
                >
                  {`Use ${capability.label}`}
                </Button>
              ) : null}
              <Button
                tone="ghost"
                onClick={() => {
                  setAbandoning(true)
                }}
              >
                I have forgotten this PIN
              </Button>
            </div>
          </div>
        </Card>

        {abandoning ? (
          <Card>
            <span className={CARD_TITLE}>Forgotten your PIN?</span>
            <p className={HONESTY_TEXT}>{FORGOTTEN_PIN_CONSEQUENCE}</p>
            <div className={ACTION_ROW}>
              <Button tone="danger" onClick={abandon}>
                Remove PIN and sign out
              </Button>
              <Button
                tone="ghost"
                onClick={() => {
                  setAbandoning(false)
                }}
              >
                Go back
              </Button>
            </div>
          </Card>
        ) : null}

        <p className={HONESTY_TEXT}>{DEVICE_PIN_HONESTY}</p>
      </div>
    </div>
  )
}
