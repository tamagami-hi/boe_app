import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { supportRequestState, type SupportRequestState } from "~/domain/status"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { Textarea } from "~/ui/primitives/Textarea"

import { ACTION_ROW, FIELD_MEASURE, STACK_LG } from "~/ui/recipes/layout"

import { SUPPORT_STATE_OPTIONS, isSupportState } from "./supportPresentation"
import {
  useRespondToSupportTicket,
  type SupportResponseInput,
  type SupportTicketDetail,
} from "./supportQueries"

const MAX_NOTE = 2_000

type Held = SupportResponseInput

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "saved"; status: SupportRequestState }>
  | Readonly<{ kind: "rejected"; message: string; reloadable: boolean }>
  | Readonly<{ kind: "unknown"; serverMessage: string | null }>

const IDLE: Outcome = { kind: "idle" }

const rejectionOf = (error: unknown): Outcome => {
  if (!isApiError(error)) {
    return { kind: "rejected", message: "The reply could not be sent. Reload the request and try again.", reloadable: true }
  }
  return { kind: "rejected", message: error.message, reloadable: error.code === "STATE_CONFLICT" }
}

const suggestedStatus = (current: SupportRequestState): SupportRequestState =>
  current === "open" ? "in_progress" : current

export type SupportResponseFormProps = Readonly<{
  ticket: SupportTicketDetail
  reloading: boolean
  onReload: () => Promise<SupportTicketDetail | null>
}>

export const SupportResponseForm = ({ ticket, reloading, onReload }: SupportResponseFormProps): React.ReactElement => {
  const respond = useRespondToSupportTicket(ticket.id)
  const [status, setStatus] = useState<SupportRequestState>(suggestedStatus(ticket.status))
  const [note, setNote] = useState(ticket.resolutionNote ?? "")
  const [baseVersion, setBaseVersion] = useState(ticket.version)
  const [held, setHeld] = useState<Held | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)

  const trimmed = note.trim()
  const unknown = outcome.kind === "unknown"
  const locked = respond.isPending || unknown
  const unchanged = status === ticket.status && trimmed === (ticket.resolutionNote ?? "")
  const noteError = trimmed === "" ? "Write the reply the client will read." : undefined
  const ready = noteError === undefined && !unchanged

  const send = (attempt: Held): void => {
    setHeld(attempt)
    setOutcome(IDLE)
    respond.mutate(attempt, {
      onSuccess: (saved) => {
        setHeld(null)
        setBaseVersion(saved.version)
        setOutcome({ kind: "saved", status: saved.status })
      },
      onError: (error) => {
        if (isUnknownWriteOutcome(error)) {
          setOutcome({ kind: "unknown", serverMessage: isApiError(error) ? error.message : null })
          return
        }
        setHeld(null)
        setOutcome(rejectionOf(error))
      },
    })
  }

  const submit = (): void => {
    if (!ready) return
    send({ status, resolutionNote: trimmed, expectedVersion: baseVersion, idempotencyKey: mintIdempotencyKey() })
  }

  const reload = async (): Promise<void> => {
    const fresh = await onReload()
    if (fresh !== null) {
      setBaseVersion(fresh.version)
      setHeld(null)
      setOutcome(IDLE)
    }
  }

  const reloadButton = (
    <Button
      size="sm"
      tone="ghost"
      disabled={respond.isPending}
      loading={reloading}
      onClick={() => {
        void reload()
      }}
    >
      Reload the request
    </Button>
  )

  return (
    <div className={STACK_LG}>
      {outcome.kind === "saved" ? (
        <Alert tone="success" title="Reply sent">
          {`The client now sees the status ${supportRequestState(outcome.status).label} with your reply, and a notification in their app.`}
        </Alert>
      ) : null}
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Nothing changed" {...(outcome.reloadable ? { action: reloadButton } : {})}>
          {outcome.message}
        </Alert>
      ) : null}
      {unknown && held !== null ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button
                size="sm"
                loading={respond.isPending}
                onClick={() => {
                  send(held)
                }}
              >
                Check again
              </Button>
              {reloadButton}
            </span>
          }
        >
          {`The reply did not arrive, so it is not known whether the client was updated. Check again repeats the same reply and cannot send it twice. Reload the request to see what the client sees now; any change after that is a new reply. ${outcome.serverMessage ?? ""}`.trim()}
        </Alert>
      ) : null}

      <div className={FIELD_MEASURE}>
        <div className={STACK_LG}>
          <FormField label="Status the client sees" required>
            {({ id }) => (
              <Select
                id={id}
                options={SUPPORT_STATE_OPTIONS}
                value={status}
                disabled={locked}
                onChange={(event) => {
                  if (isSupportState(event.target.value)) setStatus(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField
            label="Reply to the client"
            required
            hint={
              noteError ??
              (unchanged
                ? "Change the status or the reply to send an update."
                : `${String(MAX_NOTE - trimmed.length)} characters left. This replaces the reply the client sees now.`)
            }
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                maxLength={MAX_NOTE}
                value={note}
                disabled={locked}
                onChange={(event) => {
                  setNote(event.target.value)
                }}
              />
            )}
          </FormField>
        </div>
      </div>

      {unknown ? null : (
        <div className={ACTION_ROW}>
          <Button loading={respond.isPending} disabled={!ready} onClick={submit} trailing>
            Send reply
          </Button>
        </div>
      )}
    </div>
  )
}
