import { useState } from "react"

import { isUnknownWriteOutcome } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { formatDateTime } from "~/domain/dates"
import { describeClientFailure, type ClientFailure } from "~/domain/failure"
import { nomineeRequestState } from "~/domain/nomineeRequests"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { useWithdrawNomineeRequest, type NomineeRequest, type WithdrawNomineeRequestInput } from "./nomineeQueries"

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; failure: ClientFailure }>
  | Readonly<{ kind: "unknown" }>

const IDLE: Outcome = { kind: "idle" }

const NOT_CONFIRMED =
  "The reply did not arrive, so we can't tell whether your request was withdrawn. Check again repeats the same withdrawal and cannot apply it twice, or reload to see where your request stands."

type Props = Readonly<{
  request: NomineeRequest
  reloading: boolean
  onReload: () => void
}>

export const PendingNomineeRequest = ({ request, reloading, onReload }: Props): React.ReactElement => {
  const withdraw = useWithdrawNomineeRequest()
  const [held, setHeld] = useState<WithdrawNomineeRequestInput | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)

  const send = (attempt: WithdrawNomineeRequestInput): void => {
    setHeld(attempt)
    setOutcome(IDLE)
    withdraw.mutate(attempt, {
      onSuccess: () => {
        setHeld(null)
      },
      onError: (error) => {
        if (isUnknownWriteOutcome(error)) {
          setOutcome({ kind: "unknown" })
          return
        }
        setHeld(null)
        setOutcome({ kind: "rejected", failure: describeClientFailure(error, "withdrawNomineeRequest") })
      },
    })
  }

  const reloadButton = (
    <Button size="sm" tone="ghost" disabled={withdraw.isPending} loading={reloading} onClick={onReload}>
      Reload
    </Button>
  )

  return (
    <div className={STACK_LG}>
      <DataList split>
        <DetailRow label="Requested nominee">{request.nominee.name}</DetailRow>
        <DetailRow label="Relation">{request.nominee.relation}</DetailRow>
        <DetailRow label="Sent">{formatDateTime(request.createdAt)}</DetailRow>
        <DetailRow label="Status">
          <StatusBadge status={nomineeRequestState(request.state)} />
        </DetailRow>
      </DataList>
      <p className={PROSE_SM}>
        The BeOnEdge team reviews your request. You will be told in the app and by email when they accept or decline it.
        Your nominee stays as it is until then.
      </p>

      {outcome.kind === "rejected" ? (
        <Alert tone="error" title={outcome.failure.title} action={reloadButton}>
          {outcome.failure.message}
        </Alert>
      ) : null}
      {outcome.kind === "unknown" && held !== null ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button
                size="sm"
                loading={withdraw.isPending}
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
          {NOT_CONFIRMED}
        </Alert>
      ) : (
        <div className={ACTION_ROW}>
          <Button
            tone="secondary"
            loading={withdraw.isPending}
            onClick={() => {
              send({ requestId: request.id, expectedVersion: request.version, idempotencyKey: mintIdempotencyKey() })
            }}
          >
            Withdraw request
          </Button>
        </div>
      )}
    </div>
  )
}
