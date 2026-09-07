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
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"

const CODE_LENGTH = 6

const issueMessage = (error: unknown): string => {
  if (isTransportError(error)) return "We could not reach BeOnEdge. Try again."
  if (!isApiError(error)) return "We could not send the code. Try again."
  if (error.code === "RATE_LIMITED") {
    return "A code was sent recently. You can ask for another shortly."
  }
  if (error.code === "DEPENDENCY_UNAVAILABLE") {
    return "We could not send the email just now. Try again shortly."
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
    return "That code is no longer valid. Ask for a new one."
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

  const submit = (): void => {
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
        description={`We will email a six-character code to ${session.principal?.email ?? "your email address"}. Verifying it lets you start investing.`}
      />

      <Card>
        {start.isSuccess ? (
          <Alert tone="info" title="Code sent">
            Check your inbox. The code lasts ten minutes.
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

        <Form
          onSubmit={submit}
          actions={
            <>
              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={verify.isPending}
                disabled={code.length !== CODE_LENGTH}
              >
                Verify
              </Button>
              <Button
                type="button"
                tone="secondary"
                size="lg"
                fullWidth
                loading={start.isPending}
                disabled={cooldown > 0}
                onClick={requestCode}
              >
                {cooldown > 0 ? `Send another in ${formatCountdown(cooldown)}` : "Email me a code"}
              </Button>
            </>
          }
        >
          <FormField
            label="Verification code"
            hint="Six characters, exactly as they appear in the email."
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
        </Form>
      </Card>
    </Page>
  )
}

export default EmailVerificationScreen
