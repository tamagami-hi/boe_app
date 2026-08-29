import { useEffect, useMemo, useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { isNative } from "~/platform/capacitor"
import { NO_BIOMETRIC, readBiometricCapability } from "~/platform/biometric"
import type { BiometricCapability } from "~/platform/biometric"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { Switch } from "~/ui/primitives/Toggle"
import { HONESTY_TEXT } from "~/ui/recipes/text"

import { PinPad } from "./PinPad"
import {
  BIOMETRIC_HINT_NATIVE,
  BIOMETRIC_HINT_UNENROLLED,
  BIOMETRIC_HINT_WEB,
  DEVICE_PIN_HONESTY,
  DEVICE_PIN_SUBTITLE,
} from "./copy"
import { IDLE_LOCK_THRESHOLD_MS } from "./lockDecision"
import {
  MIN_PIN_LENGTH,
  browserDeviceSecurityStore,
  hasDevicePin,
  isBiometricEnabled,
  isPinShaped,
  removeDevicePin,
  setBiometricEnabled,
  setDevicePin,
  verifyDevicePin,
} from "./securityStore"

const IDLE_MINUTES = Math.round(IDLE_LOCK_THRESHOLD_MS / 60_000)

const LOCK_BEHAVIOUR = `Once a PIN is set, the Android app asks for it when it starts and again when you return to it after ${String(IDLE_MINUTES)} minutes or more in the background. On the web nothing is locked.`

type Mode = "idle" | "set" | "confirm" | "verify"

const DeviceSecurityScreen = (): React.ReactElement => {
  const store = useMemo(browserDeviceSecurityStore, [])
  const [enrolled, setEnrolled] = useState(() => hasDevicePin(store))
  const [biometric, setBiometric] = useState(() => isBiometricEnabled(store))
  const [capability, setCapability] = useState<BiometricCapability>(NO_BIOMETRIC)
  const [mode, setMode] = useState<Mode>("idle")
  const [entry, setEntry] = useState("")
  const [firstEntry, setFirstEntry] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void readBiometricCapability().then((resolved) => {
      if (cancelled) return
      setCapability(resolved)
      if (resolved.enrolled || !isBiometricEnabled(store)) return
      setBiometricEnabled(store, false)
      setBiometric(false)
    })
    return () => {
      cancelled = true
    }
  }, [store])

  const reset = (): void => {
    setMode("idle")
    setEntry("")
    setFirstEntry("")
  }

  const submitSet = (): void => {
    setFailure(null)
    if (!isPinShaped(entry)) {
      setFailure(`Choose ${String(MIN_PIN_LENGTH)} to 6 digits.`)
      return
    }
    setFirstEntry(entry)
    setEntry("")
    setMode("confirm")
  }

  const submitConfirm = (): void => {
    setFailure(null)
    if (entry !== firstEntry) {
      setFailure("Those did not match. Start again.")
      setEntry("")
      setFirstEntry("")
      setMode("set")
      return
    }
    void setDevicePin(store, entry).then(() => {
      setEnrolled(true)
      setNotice("This device now asks for your PIN.")
      reset()
    })
  }

  const submitVerify = (): void => {
    setFailure(null)
    void verifyDevicePin(store, entry).then((ok) => {
      if (!ok) {
        setFailure("That PIN is not right.")
        setEntry("")
        return
      }
      setEntry("")
      setFirstEntry("")
      setMode("set")
      setNotice("Choose a new PIN.")
    })
  }

  const remove = (): void => {
    removeDevicePin(store)
    setEnrolled(false)
    setBiometric(false)
    setRemoving(false)
    setNotice("The device PIN has been removed.")
    reset()
  }

  const biometricHint = !isNative()
    ? BIOMETRIC_HINT_WEB
    : capability.enrolled
      ? BIOMETRIC_HINT_NATIVE
      : BIOMETRIC_HINT_UNENROLLED

  return (
    <Page width="form">
      <PageHeader title="Device security" description={DEVICE_PIN_SUBTITLE} />

      <Card>
        <p className={HONESTY_TEXT}>{DEVICE_PIN_HONESTY}</p>
        <p className={HONESTY_TEXT}>{LOCK_BEHAVIOUR}</p>
      </Card>

      {notice === null ? null : (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      )}
      {failure === null ? null : (
        <Alert tone="error" title="Not saved">
          {failure}
        </Alert>
      )}

      {mode === "idle" ? (
        <Section title={enrolled ? "Your device PIN" : "Set a device PIN"}>
          <Card elevated>
            {enrolled ? (
              <>
                <Switch
                  label={
                    capability.enrolled
                      ? `Unlock with ${capability.label}`
                      : "Unlock with biometrics"
                  }
                  hint={biometricHint}
                  checked={biometric}
                  disabled={!capability.enrolled}
                  onChange={(next) => {
                    setBiometricEnabled(store, next)
                    setBiometric(next)
                  }}
                />
                <Button
                  tone="secondary"
                  onClick={() => {
                    setNotice(null)
                    setFailure(null)
                    setMode("verify")
                  }}
                >
                  Change PIN
                </Button>
                <Button
                  tone="ghost"
                  onClick={() => {
                    setRemoving(true)
                  }}
                >
                  Remove PIN
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  setNotice(null)
                  setFailure(null)
                  setMode("set")
                }}
                trailing
              >
                Set a PIN
              </Button>
            )}
          </Card>
        </Section>
      ) : (
        <Section>
          <Card elevated>
            <PinPad
              prompt={
                mode === "verify"
                  ? "Enter your current PIN"
                  : mode === "confirm"
                    ? "Enter it once more"
                    : "Choose 4 to 6 digits"
              }
              value={entry}
              onChange={setEntry}
            />
            <Button
              disabled={entry.length < MIN_PIN_LENGTH}
              onClick={
                mode === "verify" ? submitVerify : mode === "confirm" ? submitConfirm : submitSet
              }
            >
              Continue
            </Button>
            <Button tone="ghost" onClick={reset}>
              Cancel
            </Button>
          </Card>
        </Section>
      )}

      <ConfirmDialog
        open={removing}
        title="Remove the device PIN?"
        description="This device will stop asking for a PIN. Biometric unlock is switched off with it."
        confirmLabel="Remove it"
        confirmTone="danger"
        onConfirm={remove}
        onCancel={() => {
          setRemoving(false)
        }}
      />
    </Page>
  )
}

export default DeviceSecurityScreen
