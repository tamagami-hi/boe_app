import { useEffect, useState } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"

import { ApiError, isApiError, isTransportError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useSession } from "~/app/providers/SessionProvider"
import { formatCountdown } from "~/domain/dates"
import {
  useEligibility,
  useStartEmailVerification,
  useVerifyEmail,
} from "~/features/shared/queries"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { STACK_LG } from "~/ui/recipes/layout"

const CODE_LENGTH = 6

const issueMessage = (error: unknown): string => {
  if (isTransportError(error)) return "We could not reach BeOnEdge. Try again."
  if (!isApiError(error)) return "We could not send the code. Try again."
  if (error.code === "RATE_LIMITED") {
    const seconds = error.retryAfterSeconds ?? 60
    return `A code was sent recently. You can ask for another in ${formatCountdown(seconds)}.`
  }
  if (error.code === "DEPENDENCY_UNAVAILABLE") {
    return "We could not send the email. The code was created, so try resend shortly rather than starting over."
  }
  if (error.code === "STATE_CONFLICT") return "This email is already verified."
  return "We could not send the code. Try again."
}

const verifyMessage = (error: unknown): string => {
  if (isTransportError(error)) return "We could not reach BeOnEdge. Try again."
  if (!isApiError(error)) return "We could not check that code. Try again."
  if (error.code === "TOKEN_INVALID") return "That code is not correct. Check it and try again."
  if (error.code === "TOKEN_EXPIRED") return "That code has expired. Ask for a new one."
  if (error.code === "STATE_CONFLICT") {
    return "Too many attempts on this code, or there is no code waiting. Ask for a new one."
  }
  return "We could not check that code. Try again."
}

const EmailVerificationScreen = (): React.ReactElement => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const session = useSession()
  const eligibility = useEligibility()
  const start = useStartEmailVerification()
  const verify = useVerifyEmail()
  const [code, setCode] = useState("")
  const [cooldown, setCooldown] = useState(0)

  const returnTo = params.get("returnTo")
  const destination = returnTo?.startsWith("/") === true ? returnTo : "/dashboard"

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => {
      setCooldown((current) => current - 1)
    }, 1000)
    return () => {
      clearTimeout(timer)
    }
  }, [cooldown])

  if (eligibility.data?.emailVerificationState === "verified") {
    return <Navigate to={destination} replace />
  }

  const requestCode = (): void => {
    start.mutate(undefined, {
      onError: (error) => {
        if (error instanceof ApiError && error.code === "RATE_LIMITED") {
          setCooldown(error.retryAfterSeconds ?? 60)
        }
      },
      onSuccess: () => {
        setCooldown(60)
      },
    })
  }

  const submit = (event: { preventDefault: () => void }): void => {
    event.preventDefault()
    verify.mutate(code, {
      onSuccess: () => {
        void navigate(destination, { replace: true })
      },
    })
  }

  return (
    <Page width="form">
      <PageHeader
        title="Verify your email"
        description={`We send a ${String(CODE_LENGTH)}-character code to ${session.principal?.email ?? "your email"}. Investing unlocks once it is verified.`}
      />

      <Card>
        {start.isSuccess ? (
          <Alert tone="info" title="Code sent">
            Check your inbox. The code is case-sensitive and valid for ten minutes.
          </Alert>
        ) : null}
        {start.error === null ? null : (
          <Alert tone="error" title="We could not send the code">
            {issueMessage(start.error)}
          </Alert>
        )}
        {verify.error === null ? null : (
          <Alert tone="error" title="That did not work">
            {verifyMessage(verify.error)}
          </Alert>
        )}

        <form onSubmit={submit} noValidate className={STACK_LG}>
          <FormField
            label="Verification code"
            hint="Six characters, case-sensitive. Enter it exactly as it appears."
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="code"
                mono
                autoComplete="one-time-code"
                inputMode="text"
                maxLength={CODE_LENGTH}
                required
                value={code}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  setCode(event.target.value.replace(/[^A-Za-z0-9]/gu, ""))
                }}
              />
            )}
          </FormField>

          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={verify.isPending}
            disabled={code.length !== CODE_LENGTH}
          >
            Verify
          </Button>
        </form>

        <Button
          tone="secondary"
          size="md"
          fullWidth
          loading={start.isPending}
          disabled={cooldown > 0}
          onClick={requestCode}
        >
          {cooldown > 0 ? `Resend in ${formatCountdown(cooldown)}` : "Send me a code"}
        </Button>
      </Card>
    </Page>
  )
}

export default EmailVerificationScreen
