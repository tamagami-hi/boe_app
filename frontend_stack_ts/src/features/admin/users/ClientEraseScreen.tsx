import { useState } from "react"
import { useParams } from "react-router-dom"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { AlreadyErased, ErasureBlockers, ErasurePathExplainer, ErasureResult } from "./ClientErasureNotices"
import {
  ERASE_CONFIRMATION,
  useClientErasureCheck,
  useEraseClient,
  type ErasureCheck,
  type ErasureInput,
  type ErasureOutcome,
} from "./erasureQueries"

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; lines: readonly string[] }>
  | Readonly<{ kind: "unknown" }>

const IDLE: Outcome = { kind: "idle" }

const rejectionLines = (error: unknown): readonly string[] => {
  if (!isApiError(error)) return ["The request could not be sent. Nothing changed. Check again and retry."]
  const fields = Object.values(error.fields ?? {}).flat()
  return fields.length === 0 ? [error.message] : fields
}

type FormProps = Readonly<{
  userId: string
  check: ErasureCheck
  onRecheck: () => void
  rechecking: boolean
  onErased: (result: ErasureOutcome) => void
}>

const ErasureForm = ({ userId, check, onRecheck, rechecking, onErased }: FormProps): React.ReactElement => {
  const eraseClient = useEraseClient(userId)
  const [typed, setTyped] = useState("")
  const [held, setHeld] = useState<ErasureInput | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const unknown = outcome.kind === "unknown"

  const send = (attempt: ErasureInput): void => {
    setHeld(attempt)
    setOutcome(IDLE)
    eraseClient.mutate(attempt, {
      onSuccess: (result) => {
        setHeld(null)
        setOutcome(IDLE)
        onErased(result)
      },
      onError: (error) => {
        if (isUnknownWriteOutcome(error)) {
          setOutcome({ kind: "unknown" })
          return
        }
        setHeld(null)
        setTyped("")
        setOutcome({ kind: "rejected", lines: rejectionLines(error) })
        onRecheck()
      },
    })
  }

  return (
    <div className={STACK_LG}>
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Nothing changed">
          {outcome.lines.join(" ")}
        </Alert>
      ) : null}
      {unknown && held !== null ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <Button size="sm" loading={eraseClient.isPending} onClick={() => { send(held) }}>
              Check again
            </Button>
          }
        >
          The reply did not arrive, so it is not known whether the client was erased. Check again repeats the same
          request, and it can only ever apply once.
        </Alert>
      ) : null}
      {check.state === "blocked" ? (
        <>
          <ErasureBlockers blockers={check.blockers} />
          <div className={ACTION_ROW}>
            <Button tone="secondary" size="sm" loading={rechecking} onClick={onRecheck}>
              Check again
            </Button>
          </div>
        </>
      ) : null}
      <ErasurePathExplainer path={check.path} keptBecause={check.keptBecause} />
      {check.state === "erasable" ? (
        <>
          <FormField label={`Type ${ERASE_CONFIRMATION} to confirm`} hint="Capital letters, exactly as shown.">
            {({ id }) => (
              <Input
                id={id}
                value={typed}
                autoComplete="off"
                disabled={unknown || eraseClient.isPending}
                onChange={(event) => {
                  setTyped(event.target.value)
                }}
              />
            )}
          </FormField>
          <div className={ACTION_ROW}>
            <Button
              tone="danger"
              disabled={typed !== ERASE_CONFIRMATION || unknown || eraseClient.isPending || rechecking}
              loading={eraseClient.isPending && !unknown}
              onClick={() => {
                send({ expectedPath: check.path, idempotencyKey: mintIdempotencyKey() })
              }}
            >
              Erase client
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}

const ClientEraseScreen = (): React.ReactElement => {
  const { userId = "" } = useParams()
  const check = useClientErasureCheck(userId)
  const [result, setResult] = useState<ErasureOutcome | null>(null)

  return (
    <Page width="form">
      <PageHeader
        title="Erase client"
        description="Removes a client's personal details for good. It is refused while the client holds any money or anything is still open."
      />
      <AsyncBoundary query={check} skeleton={<Card><Skeleton height="6rem" /></Card>}>
        {(data) => (
          <Section title={result?.path === "deleted" ? "Deleted client" : (data.fullName ?? "Deleted client")}>
            <Card>
              {result !== null ? (
                <ErasureResult outcome={result} />
              ) : data.state === "already_erased" ? (
                <AlreadyErased check={data} />
              ) : (
                <ErasureForm
                  userId={userId}
                  check={data}
                  rechecking={check.isFetching}
                  onErased={setResult}
                  onRecheck={() => {
                    void check.refetch()
                  }}
                />
              )}
              <p className={PROSE_SM}>Only administrators who may close accounts can erase a client.</p>
            </Card>
          </Section>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default ClientEraseScreen
