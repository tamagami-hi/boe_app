import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { isUnknownWriteOutcome } from "~/api/errors"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { describeClientFailure } from "~/domain/failure"
import { useAuthPort } from "~/features/auth/authPort"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"
import { HONESTY_TEXT } from "~/ui/recipes/text"

import { useConfirmEmailChange, useRequestEmailChange } from "./profileQueries"

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/u

type Pending = Readonly<{ email: string; expiresAt: string }>

type Stage =
  | Readonly<{ kind: "ask" }>
  | Readonly<{ kind: "confirm"; pending: Pending }>
  | Readonly<{ kind: "done"; email: string | null }>

export type EmailChangePanelProps = Readonly<{ pending: Pending | null }>

export const EmailChangePanel = ({ pending }: EmailChangePanelProps): React.ReactElement => {
  const request = useRequestEmailChange()
  const confirm = useConfirmEmailChange()
  const auth = useAuthPort()
  const { signedOut } = useSession()
  const navigate = useNavigate()

  const [stage, setStage] = useState<Stage>(pending === null ? { kind: "ask" } : { kind: "confirm", pending })
  const [newEmail, setNewEmail] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [code, setCode] = useState("")
  const [failure, setFailure] = useState<Readonly<{ error: unknown; step: "requestEmailChange" | "confirmEmailChange" }> | null>(null)
  const [unchanged, setUnchanged] = useState(false)

  const signInAgain = (): void => {
    void auth.logout().finally(() => {
      signedOut()
      void navigate(auth.loginPath, { replace: true })
    })
  }

  const ask = (): void => {
    setFailure(null)
    setUnchanged(false)
    request.mutate(
      { newEmail: newEmail.trim(), currentPassword },
      {
        onSuccess: (result) => {
          setCurrentPassword("")
          if (result.status === "unchanged" || result.email === null || result.expiresAt === null) {
            setUnchanged(true)
            return
          }
          setCode("")
          setStage({ kind: "confirm", pending: { email: result.email, expiresAt: result.expiresAt } })
        },
        onError: (error) => {
          setCurrentPassword("")
          setFailure({ error, step: "requestEmailChange" })
        },
      },
    )
  }

  const submitCode = (): void => {
    setFailure(null)
    confirm.mutate(
      { code: code.trim() },
      {
        onSuccess: (result) => {
          setStage({ kind: "done", email: result.email })
        },
        onError: (error) => {
          if (isUnknownWriteOutcome(error)) {
            setStage({ kind: "done", email: null })
          }
          setFailure({ error, step: "confirmEmailChange" })
        },
      },
    )
  }

  if (stage.kind === "done") {
    return (
      <Section title="Change your email address">
        <Card elevated>
          {stage.email === null ? (
            <Alert tone="warning" title={describeClientFailure(failure?.error, "confirmEmailChange").title}>
              {describeClientFailure(failure?.error, "confirmEmailChange").message}
            </Alert>
          ) : (
            <Alert tone="success" title="Email address changed">
              {`Your account now uses ${stage.email}. Every device was signed out, including this one. Sign in again with your new address.`}
            </Alert>
          )}
          <Button onClick={signInAgain} trailing>
            Sign in again
          </Button>
        </Card>
      </Section>
    )
  }

  return (
    <Section
      title="Change your email address"
      description="We send a code to the new address. Your current address keeps working until you enter it."
    >
      <Card elevated>
        {unchanged ? (
          <Alert tone="info" title="Nothing to change">
            That is already the email address on your account.
          </Alert>
        ) : null}
        {failure === null ? null : (
          <Alert tone="error" title={describeClientFailure(failure.error, failure.step).title}>
            {describeClientFailure(failure.error, failure.step).message}
          </Alert>
        )}

        {stage.kind === "confirm" ? (
          <Form
            onSubmit={() => {
              submitCode()
            }}
            actions={
              <>
                <Button type="submit" disabled={!CODE_PATTERN.test(code.trim())} loading={confirm.isPending} trailing>
                  Confirm the new address
                </Button>
                <Button
                  tone="ghost"
                  disabled={confirm.isPending}
                  onClick={() => {
                    setFailure(null)
                    setStage({ kind: "ask" })
                  }}
                >
                  Use a different address
                </Button>
              </>
            }
          >
            <p className={HONESTY_TEXT}>
              {`We sent a 6-character code to ${stage.pending.email}. It expires ${formatDateTime(stage.pending.expiresAt)}. Confirming signs out every device, including this one.`}
            </p>
            <FormField label="Code from the email" required hint="Letters and numbers, exactly as shown, including upper and lower case.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  name="one-time-code"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  invalid={invalid}
                  mono
                  {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                  onChange={(event) => {
                    setCode(event.target.value)
                  }}
                />
              )}
            </FormField>
          </Form>
        ) : (
          <Form
            onSubmit={() => {
              ask()
            }}
            actions={
              <Button type="submit" disabled={newEmail.trim() === "" || currentPassword === ""} loading={request.isPending} trailing>
                Send a code to the new address
              </Button>
            }
          >
            <FormField label="New email address" required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={newEmail}
                  invalid={invalid}
                  {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                  onChange={(event) => {
                    setNewEmail(event.target.value)
                  }}
                />
              )}
            </FormField>
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
          </Form>
        )}
      </Card>
    </Section>
  )
}
