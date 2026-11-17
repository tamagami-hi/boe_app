import { useState } from "react"
import { useSearchParams } from "react-router-dom"

import { hasCode } from "~/api/errors"
import { AuthLayout } from "~/app/layouts/AuthLayout"
import { describeClientFailure } from "~/domain/failure"
import { useRedeemPasswordReset } from "~/features/shared/queries"
import { isNative } from "~/platform/capacitor"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Alert } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ACTION_ROW } from "~/ui/recipes/layout"

const MIN_PASSWORD_LENGTH = 12

const DOWNLOAD_COPY = {
  queued: "We are also emailing you a link to install it. You do not need the app to sign in on the web.",
  linkOnly: "You can install it from the link below. You do not need the app to sign in on the web.",
} as const

const ResetPasswordScreen = (): React.ReactElement => {
  const [params] = useSearchParams()
  const redeem = useRedeemPasswordReset()
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [done, setDone] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const token = params.get("token") ?? ""
  const native = isNative()
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
    const downloadStatus = redeem.data?.downloadEmailStatus
    const downloadUrl = redeem.data?.downloadUrl ?? null
    return (
      <AuthLayout
        eyebrow="BeOnEdge"
        panelTitle="Password set"
        panelHint="Sign in with your email address and new password, on the web or in the Android app."
      >
        <Alert tone="success" title="Your password is set">
          If this account was signed in anywhere else, those sessions have ended.
        </Alert>
        <ButtonLink to="/login" fullWidth>
          Sign in
        </ButtonLink>
        {native || downloadUrl === null ? null : (
          <>
            <Alert tone="info" title="Prefer the Android app?">
              {downloadStatus === "queued" ? DOWNLOAD_COPY.queued : DOWNLOAD_COPY.linkOnly}
            </Alert>
            <a href={downloadUrl} className="underline" referrerPolicy="no-referrer">
              Download the Android app
            </a>
          </>
        )}
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
      {hasCode(error, "INVALID_CREDENTIALS") ? (
        <div className={ACTION_ROW}>
          <ButtonLink to="/password/forgot" tone="secondary">
            Request a new link
          </ButtonLink>
          <ButtonLink to="/login" tone="ghost">
            Sign in if you already set it
          </ButtonLink>
        </div>
      ) : null}

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
