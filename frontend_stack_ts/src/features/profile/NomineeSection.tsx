import { useState } from "react"

import { hasCode, isUnknownWriteOutcome } from "~/api/errors"
import { Section } from "~/app/layouts/Section"
import { describeClientFailure, type ClientFailure } from "~/domain/failure"
import {
  NOMINEE_MAX_LENGTH,
  nomineeInput,
  nomineeProblems,
  nomineeRefusals,
  sameNominee,
  type NomineeDraft,
  type NomineeField,
  type NomineeProblems,
} from "~/domain/nominee"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"
import { PROSE_SM } from "~/ui/recipes/datalist"

import { useChangeClientNominee, useClientNominee, type ClientNominee } from "./nomineeQueries"

type Saved = "changed" | "removed" | "unchanged"

const NOT_CONFIRMED: ClientFailure = {
  title: "Not confirmed",
  message:
    "The reply did not arrive, so we can't tell whether your nominee was saved. Reload to see the nominee on your account.",
  retryable: true,
}

const failureOf = (error: unknown): ClientFailure =>
  isUnknownWriteOutcome(error) ? NOT_CONFIRMED : describeClientFailure(error, "changeNominee")

const SAVED_COPY: Readonly<Record<Saved, Readonly<{ title: string; body: string }>>> = {
  changed: { title: "Nominee saved", body: "Your nominee and their relation to you are saved on your account." },
  removed: { title: "Nominee removed", body: "Your account no longer has a nominee." },
  unchanged: { title: "Nothing to change", body: "That is already the nominee on your account." },
}

type FormProps = Readonly<{
  current: ClientNominee["nominee"]
  reloading: boolean
  onReload: () => void
  onSaved: (saved: Saved) => void
}>

const NomineeForm = ({ current, reloading, onReload, onSaved }: FormProps): React.ReactElement => {
  const change = useChangeClientNominee()
  const [draft, setDraft] = useState<NomineeDraft>({ name: current?.name ?? "", relation: current?.relation ?? "" })
  const [currentPassword, setCurrentPassword] = useState("")
  const [failure, setFailure] = useState<unknown>(null)
  const [refusals, setRefusals] = useState<NomineeProblems>({})

  const input = nomineeInput(draft)
  const problems = nomineeProblems(draft)
  const removing = input?.name === null
  const ready =
    input !== null && currentPassword !== "" && Object.keys(problems).length === 0 && !sameNominee(input, current)
  const errorFor = (field: NomineeField): string | undefined => problems[field] ?? refusals[field]

  const submit = (): void => {
    if (input === null) return
    setFailure(null)
    setRefusals({})
    change.mutate(
      { input, currentPassword },
      {
        onSuccess: (result) => {
          setCurrentPassword("")
          onSaved(result.status === "unchanged" ? "unchanged" : result.nominee === null ? "removed" : "changed")
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
          <Button type="submit" disabled={!ready} loading={change.isPending} trailing>
            {removing ? "Remove my nominee" : "Save my nominee"}
          </Button>
        }
      >
        <FormField label="Nominee's full name" hint="As it appears on their identity documents." error={errorFor("name")}>
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

export const NomineeSection = (): React.ReactElement => {
  const nominee = useClientNominee()
  const [saved, setSaved] = useState<Saved | null>(null)

  return (
    <Section
      title="Nominee"
      description="The person you nominate on your BeOnEdge account, and their relation to you. Confirm any change with your current password; clear both fields to remove them."
    >
      <AsyncBoundary query={nominee} skeleton={<Skeleton height="6rem" />}>
        {(data) => (
          <Card elevated>
            {saved === null ? null : (
              <Alert tone={saved === "unchanged" ? "info" : "success"} title={SAVED_COPY[saved].title}>
                {SAVED_COPY[saved].body}
              </Alert>
            )}
            {data.nominee === null ? (
              <p className={PROSE_SM}>No nominee is recorded on your account yet.</p>
            ) : (
              <DataList split>
                <DetailRow label="Nominee">{data.nominee.name}</DetailRow>
                <DetailRow label="Relation">{data.nominee.relation}</DetailRow>
              </DataList>
            )}
            <NomineeForm
              key={String(data.version)}
              current={data.nominee}
              reloading={nominee.isFetching}
              onReload={() => {
                setSaved(null)
                void nominee.refetch()
              }}
              onSaved={setSaved}
            />
          </Card>
        )}
      </AsyncBoundary>
    </Section>
  )
}
