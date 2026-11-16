import { useState } from "react"

import { hasCode, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { describeClientFailure, type ClientFailure } from "~/domain/failure"
import {
  NOMINEE_MAX_LENGTH,
  nomineeProblems,
  nomineeRefusals,
  requestedNomineeOf,
  sameNominee,
  type NomineeDraft,
  type NomineeField,
  type NomineeProblems,
} from "~/domain/nominee"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"

import { useSendNomineeRequest, type ClientNominee } from "./nomineeQueries"

const NOT_CONFIRMED: ClientFailure = {
  title: "Not confirmed",
  message:
    "The reply did not arrive, so we can't tell whether your request was sent. Reload to see it. Sending the same request again cannot create a second one.",
  retryable: true,
}

const ALREADY_NOMINEE = "That is already the nominee on your account."

const failureOf = (error: unknown): ClientFailure =>
  isUnknownWriteOutcome(error) ? NOT_CONFIRMED : describeClientFailure(error, "sendNomineeRequest")

type Props = Readonly<{
  current: ClientNominee["nominee"]
  reloading: boolean
  onReload: () => void
}>

export const NomineeRequestForm = ({ current, reloading, onReload }: Props): React.ReactElement => {
  const send = useSendNomineeRequest()
  const [draft, setDraft] = useState<NomineeDraft>({ name: "", relation: "" })
  const [currentPassword, setCurrentPassword] = useState("")
  const [failure, setFailure] = useState<unknown>(null)
  const [refusals, setRefusals] = useState<NomineeProblems>({})

  const requested = requestedNomineeOf(draft)
  const idempotencyKey = useIdempotencyKey(requested)
  const problems = nomineeProblems(draft)
  const unchanged = requested !== null && sameNominee(requested, current)
  const ready = requested !== null && currentPassword !== "" && Object.keys(problems).length === 0 && !unchanged
  const errorFor = (field: NomineeField): string | undefined => problems[field] ?? refusals[field]

  const submit = (): void => {
    if (requested === null || !ready) return
    setFailure(null)
    setRefusals({})
    send.mutate(
      { ...requested, currentPassword, idempotencyKey },
      {
        onSuccess: () => {
          setCurrentPassword("")
        },
        onError: (cause) => {
          setCurrentPassword("")
          setFailure(cause)
          setRefusals(nomineeRefusals(cause))
        },
      },
    )
  }

  const edit = (field: NomineeField, value: string): void => {
    setDraft((previous) => ({ ...previous, [field]: value }))
    setRefusals((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== field)))
  }

  const shown = failure === null ? null : failureOf(failure)
  const reloadable = shown === NOT_CONFIRMED || hasCode(failure, "STATE_CONFLICT")

  return (
    <>
      {shown === null ? null : (
        <Alert
          tone={shown === NOT_CONFIRMED ? "warning" : "error"}
          title={shown.title}
          {...(reloadable
            ? {
                action: (
                  <Button size="sm" tone="ghost" loading={reloading} onClick={onReload}>
                    Reload
                  </Button>
                ),
              }
            : {})}
        >
          {shown.message}
        </Alert>
      )}
      <Form
        onSubmit={submit}
        actions={
          <Button type="submit" disabled={!ready} loading={send.isPending} trailing>
            Send request
          </Button>
        }
      >
        <FormField
          label="Nominee's full name"
          hint={unchanged ? ALREADY_NOMINEE : "As it appears on their identity documents."}
          error={errorFor("name")}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="nominee-name"
              autoComplete="off"
              maxLength={NOMINEE_MAX_LENGTH}
              value={draft.name}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
              onChange={(event) => {
                edit("name", event.target.value)
              }}
            />
          )}
        </FormField>
        <FormField label="Relation to you" hint="For example spouse, son, daughter or parent." error={errorFor("relation")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="nominee-relation"
              autoComplete="off"
              maxLength={NOMINEE_MAX_LENGTH}
              value={draft.relation}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
              onChange={(event) => {
                edit("relation", event.target.value)
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
    </>
  )
}
