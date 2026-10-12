import { useState } from "react"
import type { ReactNode } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { Button } from "~/ui/primitives/Button"
import type { ButtonTone } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Alert } from "~/ui/primitives/Feedback"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

export type SendReceipt = Readonly<{ title: string; detail: string }>

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "queued"; receipt: SendReceipt }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "unknown" }>

const IDLE: Outcome = { kind: "idle" }

const describeRejection = (error: unknown): string => {
  if (!isApiError(error)) return "This email could not be sent. Reload the page and try again."
  if (error.code === "RATE_LIMITED") {
    return "This address was sent a message a moment ago. Wait a minute, then try again."
  }
  if (error.code === "RESOURCE_NOT_FOUND") return "That template or client could not be found. Reload the page and choose again."
  return error.message
}

export type SendActionProps = Readonly<{
  label: string
  tone?: ButtonTone
  disabled: boolean
  confirmTitle: string
  confirmLabel: string
  confirmBody: ReactNode
  request: Readonly<Record<string, unknown>>
  send: (idempotencyKey: string) => Promise<SendReceipt>
}>

export const SendAction = ({
  label,
  tone = "primary",
  disabled,
  confirmTitle,
  confirmLabel,
  confirmBody,
  request,
  send,
}: SendActionProps): React.ReactElement => {
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmingRestart, setConfirmingRestart] = useState(false)
  const idempotencyKey = useIdempotencyKey({ ...request, attempt })

  const run = async (): Promise<void> => {
    setConfirming(false)
    setPending(true)
    try {
      const receipt = await send(idempotencyKey)
      setOutcome({ kind: "queued", receipt })
      setAttempt((current) => current + 1)
    } catch (error) {
      setOutcome(isUnknownWriteOutcome(error) ? { kind: "unknown" } : { kind: "rejected", message: describeRejection(error) })
    } finally {
      setPending(false)
    }
  }

  const startNewAttempt = (): void => {
    setConfirmingRestart(false)
    setAttempt((current) => current + 1)
    setOutcome(IDLE)
  }

  return (
    <div className={STACK_LG}>
      {outcome.kind === "queued" ? (
        <Alert
          tone="success"
          title={outcome.receipt.title}
          action={
            <ButtonLink to="/emails" tone="secondary" size="sm">
              Open the delivery log
            </ButtonLink>
          }
        >
          {outcome.receipt.detail}
        </Alert>
      ) : null}

      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Not sent">
          {outcome.message}
        </Alert>
      ) : null}

      {outcome.kind === "unknown" ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button size="sm" loading={pending} onClick={() => void run()}>
                Check again
              </Button>
              <Button
                size="sm"
                tone="secondary"
                disabled={pending}
                onClick={() => {
                  setConfirmingRestart(true)
                }}
              >
                Start a new attempt
              </Button>
            </span>
          }
        >
          The reply did not arrive, so it is not known whether this email was queued. Check again
          sends the same request once more, and it can only ever be queued once.
        </Alert>
      ) : null}

      {outcome.kind === "unknown" ? null : (
        <span className={ACTION_ROW}>
          <Button
            tone={tone}
            disabled={disabled || pending}
            loading={pending}
            onClick={() => {
              setConfirming(true)
            }}
          >
            {label}
          </Button>
        </span>
      )}

      <ConfirmDialog
        open={confirming}
        title={confirmTitle}
        confirmLabel={confirmLabel}
        pending={pending}
        onConfirm={() => void run()}
        onCancel={() => {
          setConfirming(false)
        }}
      >
        {confirmBody}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingRestart}
        title="Start a new attempt?"
        description="Check the delivery log first. If this email is already listed, it was queued, and a new attempt would send it a second time."
        confirmLabel="Start a new attempt"
        confirmTone="danger"
        cancelLabel="Keep this attempt"
        onConfirm={startNewAttempt}
        onCancel={() => {
          setConfirmingRestart(false)
        }}
      />
    </div>
  )
}
