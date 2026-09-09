import { useState } from "react"

import { AuthLayout } from "~/app/layouts/AuthLayout"
import { describeClientFailure } from "~/domain/failure"
import { useRequestPasswordReset } from "~/features/shared/queries"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Alert } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"

const ForgotPasswordScreen = (): React.ReactElement => {
  const request = useRequestPasswordReset()
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const submit = (): void => {
    setError(null)
    request.mutate(email.trim(), {
      onSuccess: () => {
        setSent(true)
      },
      onError: (cause) => {
        setError(cause)
      },
    })
  }

  return (
    <AuthLayout
      eyebrow="BeOnEdge"
      tagline="Managed fund pools, with your value updated for you every month."
      panelTitle="Reset your password"
      panelHint="We will email you a link to choose a new one."
    >
      {error === null ? null : (
        <Alert tone="error" title={describeClientFailure(error, "requestPasswordReset").title}>
          {describeClientFailure(error, "requestPasswordReset").message}
        </Alert>
      )}

      {sent ? (
        <>
          <Alert tone="success" title="Check your email">
            If an account uses that address, a reset link is on its way. It works once and expires
            shortly.
          </Alert>
          <ButtonLink to="/login" tone="secondary" fullWidth>
            Back to sign in
          </ButtonLink>
        </>
      ) : (
        <Form
          onSubmit={() => {
            submit()
          }}
          actions={
            <>
              <Button
                type="submit"
                fullWidth
                size="lg"
                disabled={email.trim() === ""}
                loading={request.isPending}
              >
                Email me a reset link
              </Button>
              <ButtonLink to="/login" tone="ghost" fullWidth>
                Back to sign in
              </ButtonLink>
            </>
          }
        >
          <FormField label="Email" required>
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
        </Form>
      )}
    </AuthLayout>
  )
}

export default ForgotPasswordScreen
