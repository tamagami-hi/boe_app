import { useState } from "react"
import { useSearchParams } from "react-router-dom"

import { AuthLayout } from "~/app/layouts/AuthLayout"
import { describeClientFailure } from "~/domain/failure"
import { useRedeemPasswordReset } from "~/features/shared/queries"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Alert } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"

const MIN_PASSWORD_LENGTH = 12

const ResetPasswordScreen = (): React.ReactElement => {
  const [params] = useSearchParams()
  const redeem = useRedeemPasswordReset()
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [done, setDone] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const token = params.get("token") ?? ""
  const passwordLength = Array.from(newPassword).length
  const tooShort = newPassword !== "" && passwordLength < MIN_PASSWORD_LENGTH
  const mismatched = confirmation !== "" && confirmation !== newPassword
  const ready =
    token !== "" && passwordLength >= MIN_PASSWORD_LENGTH && confirmation === newPassword

  const submit = (): void => {
    setError(null)
    redeem.mutate(
      { token, newPassword },
      {
        onSuccess: () => {
          setDone(true)
        },
        onError: (cause) => {
          setError(cause)
        },
      },
    )
  }

  if (token === "") {
    return (
      <AuthLayout
        eyebrow="BeOnEdge"
        panelTitle="Reset your password"
        panelHint="This link is incomplete."
      >
        <Alert tone="error" title="No reset token">
          Open the link from your email exactly as it was sent. If it has expired, ask for a new one.
        </Alert>
        <ButtonLink to="/password/forgot" tone="secondary" fullWidth>
          Request a new link
        </ButtonLink>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout
        eyebrow="BeOnEdge"
        panelTitle="Password set"
        panelHint="Download the app, install it, and sign in with your new password."
      >
        <Alert tone="success" title="Your password has been changed">
          Every other device that was signed in has been signed out.
        </Alert>
        <Alert
          tone={redeem.data?.downloadEmailStatus === "sent" ? "success" : "warning"}
          title={redeem.data?.downloadEmailStatus === "sent" ? "App download link sent" : "Download email not confirmed"}
        >
          {redeem.data?.downloadEmailStatus === "sent"
            ? "We sent the app download link to your email. Check your inbox or spam folder, download and install the app, then sign in with your email address and new password."
            : redeem.data?.downloadEmailStatus === "unavailable"
              ? "Your password is set, but an app download is not available yet. Contact support for the installer, or sign in if you already have the app."
              : "Your password is set, but we could not confirm sending the download email. Use the download link below if available, or contact support for the installer."}
        </Alert>
        {redeem.data?.downloadUrl == null ? null : (
          <a href={redeem.data.downloadUrl} className="underline" referrerPolicy="no-referrer">Download the Android app</a>
        )}
        <ButtonLink to="/login" tone="secondary" fullWidth>
          Continue to web sign in
        </ButtonLink>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      eyebrow="BeOnEdge"
      panelTitle="Choose a new password"
      panelHint="It needs at least 12 characters."
    >
      {error === null ? null : (
        <Alert tone="error" title={describeClientFailure(error, "resetPassword").title}>
          {describeClientFailure(error, "resetPassword").message}
        </Alert>
      )}

      <Form
        onSubmit={() => {
          submit()
        }}
        actions={
          <Button type="submit" fullWidth size="lg" disabled={!ready} loading={redeem.isPending}>
            Set my password
          </Button>
        }
      >
        <FormField
          label="New password"
          required
          {...(tooShort ? { error: "Use at least 12 characters." } : {})}
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
    </AuthLayout>
  )
}

export default ResetPasswordScreen
