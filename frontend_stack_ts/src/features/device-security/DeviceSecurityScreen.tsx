import { useMemo, useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { isNative } from "~/platform/capacitor"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { Switch } from "~/ui/primitives/Toggle"
import { HONESTY_TEXT } from "~/ui/recipes/text"

import { PinPad } from "./PinPad"
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

const HONESTY =
  "This lock protects against casual access on a shared device. It is checked on this device only: it is not a password, it does not involve the server, and it does not encrypt anything. Anyone who can read this device's storage can bypass it. Your account password remains the thing that protects your money."

type Mode = "idle" | "set" | "confirm" | "verify"

const DeviceSecurityScreen = (): React.ReactElement => {
  const store = useMemo(browserDeviceSecurityStore, [])
  const [enrolled, setEnrolled] = useState(() => hasDevicePin(store))
  const [biometric, setBiometric] = useState(() => isBiometricEnabled(store))
  const [mode, setMode] = useState<Mode>("idle")
  const [entry, setEntry] = useState("")
  const [firstEntry, setFirstEntry] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

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

  return (
    <Page width="form">
      <PageHeader
        title="Device security"
        description="An optional PIN for this device. It is a convenience, not a security boundary."
      />

      <Card>
        <p className={HONESTY_TEXT}>{HONESTY}</p>
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
                  label="Unlock with biometrics"
                  hint={
                    isNative()
                      ? "Uses whatever fingerprint or face this device already trusts. Enrolment changes on the device are honoured, which is a convenience trade-off, not a trust boundary."
                      : "Biometric unlock needs the Android app. On the web the PIN is the only option."
                  }
                  checked={biometric}
                  disabled={!isNative()}
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
