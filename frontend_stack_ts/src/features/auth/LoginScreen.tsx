import { useState } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"

import { ApiError, isApiError, isTransportError } from "~/api/errors"
import { AuthLayout } from "~/app/layouts/AuthLayout"
import { useSession } from "~/app/providers/SessionProvider"
import { useAuthPort } from "~/features/auth/authPort"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

const messageFor = (error: unknown): string => {
  if (isTransportError(error)) {
    return error.kind === "timeout"
      ? "That took too long. Nothing was changed — try again."
      : "We cannot reach BeOnEdge. Check your connection and try again."
  }
  if (!isApiError(error)) return "We could not sign you in. Try again."
  const byCode: Partial<Record<string, string>> = {
    INVALID_CREDENTIALS: "That email and password combination is not correct.",
    ACCOUNT_NOT_ACTIVE: "This account is not active. Contact support to continue.",
    RATE_LIMITED: "Too many attempts just now. Wait a moment and try again.",
    VALIDATION_FAILED: error.message,
    DEPENDENCY_UNAVAILABLE: "Sign-in is temporarily unavailable. Try again shortly.",
  }
  return byCode[error.code] ?? "We could not sign you in. Try again."
}

const LoginScreen = (): React.ReactElement => {
  const port = useAuthPort()
  const session = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const from = params.get("from")
  const destination = from?.startsWith("/") === true ? from : port.homePath

  if (session.status === "authenticated") return <Navigate to={destination} replace />

  const fieldErrors = error instanceof ApiError ? error.fields : null

  const submit = async (event: { preventDefault: () => void }): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const principal = await port.login({ email: email.trim(), password })
      session.signedIn(principal)
      void navigate(destination, { replace: true })
    } catch (cause) {
      setError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      eyebrow={port.audienceLabel}
      tagline="Fund pools managed by an administrator, valued from an append-only ledger. No projections, no guesswork."
      panelTitle="Sign in"
      panelHint="Use the email and password your account was created with."
    >
      {session.endedReason === null ? null : (
        <Alert tone="warning" title="You were signed out">
          {session.endedReason === "expired"
            ? "Your session expired. Sign in again to continue."
            : "Your session was ended for security. Sign in again to continue."}
        </Alert>
      )}
      {error === null ? null : (
        <Alert tone="error" title="Sign-in failed">
          {messageFor(error)}
        </Alert>
      )}
      <form
        onSubmit={(event) => {
          void submit(event)
        }}
        noValidate
      >
        <FormField label="Email" required {...(fieldErrors?.email?.[0] === undefined ? {} : { error: fieldErrors.email[0] })}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
              onChange={(event) => {
                setEmail(event.target.value)
              }}
            />
          )}
        </FormField>
        <FormField
          label="Password"
          required
          {...(fieldErrors?.password?.[0] === undefined ? {} : { error: fieldErrors.password[0] })}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
              onChange={(event) => {
                setPassword(event.target.value)
              }}
            />
          )}
        </FormField>
        <Button type="submit" fullWidth size="lg" loading={submitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}

export default LoginScreen
