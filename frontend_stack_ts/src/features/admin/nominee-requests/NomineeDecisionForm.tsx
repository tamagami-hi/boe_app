import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { formatDateTime } from "~/domain/dates"
import { DECLINE_REASON_MAX_LENGTH, declineReasonProblem } from "~/domain/nominee"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, FIELD_MEASURE, STACK_LG } from "~/ui/recipes/layout"

import {
  useDecideNomineeRequest,
  type AdminNomineeRequest,
  type NomineeDecision,
  type NomineeDecisionInput,
} from "./nomineeRequestQueries"

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string; reloadable: boolean }>
  | Readonly<{ kind: "unknown"; serverMessage: string | null }>

const IDLE: Outcome = { kind: "idle" }

const rejectionOf = (error: unknown): Outcome => {
  if (!isApiError(error)) {
    return { kind: "rejected", message: "The decision could not be sent. Reload the requests and try again.", reloadable: true }
  }
  return { kind: "rejected", message: error.message, reloadable: error.code === "STATE_CONFLICT" }
}

export type NomineeDecisionFormProps = Readonly<{
  userId: string
  request: AdminNomineeRequest
  nomineeVersion: number
  canAccept: boolean
  reloading: boolean
  onReload: () => void
  onDecided: (decision: NomineeDecision) => void
}>

export const NomineeDecisionForm = ({
  userId,
  request,
  nomineeVersion,
  canAccept,
  reloading,
  onReload,
  onDecided,
}: NomineeDecisionFormProps): React.ReactElement => {
  const decide = useDecideNomineeRequest(userId)
  const [reason, setReason] = useState("")
  const [held, setHeld] = useState<NomineeDecisionInput | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)

  const reasonProblem = declineReasonProblem(reason)
  const unknown = outcome.kind === "unknown"
  const locked = decide.isPending || unknown

  const send = (attempt: NomineeDecisionInput): void => {
    setHeld(attempt)
    setOutcome(IDLE)
    decide.mutate(attempt, {
      onSuccess: (decision) => {
        setHeld(null)
        onDecided(decision)
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

  const accept = (): void => {
    send({
      verb: "accept",
      requestId: request.id,
      expectedVersion: request.version,
      expectedNomineeVersion: nomineeVersion,
      idempotencyKey: mintIdempotencyKey(),
    })
  }

  const decline = (): void => {
    const trimmed = reason.trim()
    send({
      verb: "decline",
      requestId: request.id,
      expectedVersion: request.version,
      reason: trimmed === "" ? null : trimmed,
      idempotencyKey: mintIdempotencyKey(),
    })
  }

  const reload = (): void => {
    onReload()
    setHeld(null)
    setOutcome(IDLE)
  }

  const reloadButton = (
    <Button
      size="sm"
      tone="ghost"
      disabled={decide.isPending}
      loading={reloading}
      onClick={reload}
    >
      Reload the requests
    </Button>
  )

  return (
    <div className={STACK_LG}>
      <DataList split>
        <DetailRow label="Requested nominee">{request.nominee.name}</DetailRow>
        <DetailRow label="Relation">{request.nominee.relation}</DetailRow>
        <DetailRow label="Sent">{formatDateTime(request.createdAt)}</DetailRow>
      </DataList>

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
                loading={decide.isPending}
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
          {`The reply did not arrive, so it is not known whether the decision was saved. Check again repeats the same decision and cannot apply it twice. Reload the requests to see where it stands; any decision after that is a new one. ${outcome.serverMessage ?? ""}`.trim()}
        </Alert>
      ) : null}

      <div className={FIELD_MEASURE}>
        <FormField
          label="Reason for declining (optional)"
          hint={`The client sees this reason in the app, and in the email while the account is active. Up to ${String(DECLINE_REASON_MAX_LENGTH)} characters on one line.`}
          error={reasonProblem ?? undefined}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={reason}
              maxLength={DECLINE_REASON_MAX_LENGTH}
              autoComplete="off"
              disabled={locked}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
          )}
        </FormField>
      </div>

      {canAccept ? null : (
        <p className={PROSE_SM}>This account is closed, so the request can only be declined.</p>
      )}
      {unknown ? null : (
        <div className={ACTION_ROW}>
          <Button disabled={locked || !canAccept} loading={decide.isPending && held?.verb === "accept"} onClick={accept}>
            Accept and set the nominee
          </Button>
          <Button
            tone="secondary"
            disabled={locked || reasonProblem !== null}
            loading={decide.isPending && held?.verb === "decline"}
            onClick={decline}
          >
            Decline
          </Button>
        </div>
      )}
    </div>
  )
}
