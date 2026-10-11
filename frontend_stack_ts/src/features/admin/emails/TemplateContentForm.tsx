import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import type { FieldErrors } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { Prose } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Textarea } from "~/ui/primitives/Textarea"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import type { TemplateContent } from "./emailTemplateQueries"

const NAME_MAX = 120
const DESCRIPTION_MAX = 500
const SUBJECT_MAX = 150
const BODY_MAX = 5_000
const BODY_ROWS = 14

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string; fields: FieldErrors; stale: boolean }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "saved" }>

const IDLE: Outcome = { kind: "idle" }

const describeRejection = (error: unknown): Outcome => {
  if (!isApiError(error)) {
    return { kind: "rejected", message: "This template could not be saved. Reload the page and try again.", fields: {}, stale: false }
  }
  if (error.code === "VALIDATION_FAILED") {
    return { kind: "rejected", message: "Some fields need attention.", fields: error.fields ?? {}, stale: false }
  }
  return { kind: "rejected", message: error.message, fields: {}, stale: error.code === "STATE_CONFLICT" }
}

const firstOf = (fields: FieldErrors, key: string): string | undefined => fields[key]?.[0]

export type TemplateContentFormProps = Readonly<{
  initial: TemplateContent
  placeholders: readonly string[]
  locked: boolean
  saveLabel: string
  save: (content: TemplateContent, idempotencyKey: string) => Promise<void>
  onReload?: () => void
}>

export const TemplateContentForm = ({
  initial,
  placeholders,
  locked,
  saveLabel,
  save,
  onReload,
}: TemplateContentFormProps): React.ReactElement => {
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [baseline, setBaseline] = useState(initial)
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [pending, setPending] = useState(false)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  const content: TemplateContent = { name, description, subject, body }
  const idempotencyKey = useIdempotencyKey({ ...content, attempt })
  const fields = outcome.kind === "rejected" ? outcome.fields : {}
  const held = locked || pending || outcome.kind === "unknown"
  const unchanged =
    name === baseline.name && description === baseline.description && subject === baseline.subject && body === baseline.body
  const incomplete = name.trim() === "" || subject.trim() === "" || body.trim() === ""
  const tokens = placeholders.map((placeholder) => `{{${placeholder}}}`).join(", ")

  const submit = async (): Promise<void> => {
    setPending(true)
    try {
      await save(content, idempotencyKey)
      setBaseline(content)
      setAttempt((current) => current + 1)
      setOutcome({ kind: "saved" })
    } catch (error) {
      setOutcome(isUnknownWriteOutcome(error) ? { kind: "unknown" } : describeRejection(error))
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
    <Card elevated>
      <div className={STACK_LG}>
        {outcome.kind === "saved" ? (
          <Alert tone="success" title="Saved">
            The template is saved. The next email sent from it uses this version.
          </Alert>
        ) : null}

        {outcome.kind === "rejected" ? (
          <Alert
            tone="error"
            title="Not saved"
            action={
              outcome.stale && onReload !== undefined ? (
                <Button size="sm" tone="secondary" onClick={onReload}>
                  Load the latest version
                </Button>
              ) : undefined
            }
          >
            {outcome.message}
            {outcome.stale ? " Loading the latest version replaces what is in this form." : ""}
          </Alert>
        ) : null}

        {outcome.kind === "unknown" ? (
          <Alert
            tone="warning"
            title="Not confirmed"
            action={
              <span className={ACTION_ROW}>
                <Button size="sm" loading={pending} onClick={() => void submit()}>
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
            The reply did not arrive, so it is not known whether this template was saved. Check again
            sends the same request once more, and it can only ever be saved once.
          </Alert>
        ) : null}

        <FormField label="Name" required hint="Shown to admins only." error={firstOf(fields, "name")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={name}
              maxLength={NAME_MAX}
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={held}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
          )}
        </FormField>

        <FormField label="When to use it" hint="Optional. Shown to admins only." error={firstOf(fields, "description")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={description}
              maxLength={DESCRIPTION_MAX}
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={held}
              onChange={(event) => {
                setDescription(event.target.value)
              }}
            />
          )}
        </FormField>

        <FormField label="Subject" required error={firstOf(fields, "subject")}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={subject}
              maxLength={SUBJECT_MAX}
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={held}
              onChange={(event) => {
                setSubject(event.target.value)
              }}
            />
          )}
        </FormField>

        <FormField
          label="Message"
          required
          hint={`Plain text only. You can use ${tokens}; each is replaced with the client's name when the email is sent.`}
          error={firstOf(fields, "body")}
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              value={body}
              rows={BODY_ROWS}
              maxLength={BODY_MAX}
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={held}
              onChange={(event) => {
                setBody(event.target.value)
              }}
            />
          )}
        </FormField>

        <Prose>
          Saving keeps every earlier version exactly as it was. Emails already sent are never changed.
        </Prose>

        {outcome.kind === "unknown" || locked ? null : (
          <Button disabled={held || incomplete || unchanged} loading={pending} onClick={() => void submit()}>
            {saveLabel}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmingRestart}
        title="Start a new attempt?"
        description="Check the template list first. If this change is already there, it was saved, and a new attempt would save it again as another version."
        confirmLabel="Start a new attempt"
        confirmTone="danger"
        cancelLabel="Keep this attempt"
        onConfirm={startNewAttempt}
        onCancel={() => {
          setConfirmingRestart(false)
        }}
      />
    </Card>
  )
}
