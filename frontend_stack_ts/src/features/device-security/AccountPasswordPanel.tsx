import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { describeClientFailure } from "~/domain/failure"
import { useAuthPort } from "~/features/auth/authPort"
import { useChangePassword } from "~/features/shared/queries"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"
import { HONESTY_TEXT } from "~/ui/recipes/text"

const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128

const REVOCATION_NOTICE =
  "Changing it signs out every device, including this one, so you will be asked to sign in again."

export const AccountPasswordPanel = (): React.ReactElement => {
  const change = useChangePassword()
  const auth = useAuthPort()
  const { signedOut } = useSession()
  const navigate = useNavigate()

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [changed, setChanged] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)

  const newLength = Array.from(newPassword).length
  const tooShort = newPassword !== "" && newLength < MIN_PASSWORD_LENGTH
  const mismatched = confirmation !== "" && confirmation !== newPassword
  const reused = newPassword !== "" && newPassword === currentPassword
  const ready =
    currentPassword !== "" &&
    newLength >= MIN_PASSWORD_LENGTH &&
    newLength <= MAX_PASSWORD_LENGTH &&
    confirmation === newPassword &&
    !reused

  const submit = (): void => {
    setFailure(null)
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("")
          setNewPassword("")
          setConfirmation("")
          setChanged(true)
        },
        onError: (cause) => {
          setFailure(cause)
        },
      },
    )
  }

  const finishSignOut = (): void => {
    void auth.logout().finally(() => {
      signedOut()
      void navigate(auth.loginPath, { replace: true })
    })
  }

  if (changed) {
    return (
      <Section title="Your password">
        <Card elevated>
          <Alert tone="success" title="Your password has been changed">
            Every device that was signed in has been signed out, including this one. Sign in again
            with your new password.
          </Alert>
          <Button onClick={finishSignOut} trailing>
            Sign in again
          </Button>
        </Card>
      </Section>
    )
  }

  return (
    <Section title="Your password">
      <Card elevated>
        <p className={HONESTY_TEXT}>{REVOCATION_NOTICE}</p>

        {failure === null ? null : (
          <Alert tone="error" title={describeClientFailure(failure, "changePassword").title}>
            {describeClientFailure(failure, "changePassword").message}
          </Alert>
        )}

        <Form
          onSubmit={() => {
            submit()
          }}
          actions={
            <Button type="submit" disabled={!ready} loading={change.isPending} trailing>
              Change my password
            </Button>
          }
        >
          <FormField label="Current password" required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  setCurrentPassword(event.target.value)
                }}
              />
            )}
          </FormField>

          <FormField
            label="New password"
            required
            hint="At least 12 characters."
            {...(tooShort
              ? { error: "Use at least 12 characters." }
              : reused
                ? { error: "Choose a password you are not already using." }
                : {})}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  setNewPassword(event.target.value)
                }}
              />
            )}
          </FormField>

          <FormField
            label="Confirm new password"
            required
            {...(mismatched ? { error: "Both entries must match." } : {})}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  setConfirmation(event.target.value)
                }}
              />
            )}
          </FormField>
        </Form>
      </Card>
    </Section>
  )
}
