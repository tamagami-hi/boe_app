import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { REVIEW_STATE_OPTIONS, isReviewState, reviewState, type ReviewState } from "~/domain/reviews"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { Textarea } from "~/ui/primitives/Textarea"
import { ACTION_ROW, FIELD_MEASURE, STACK_LG } from "~/ui/recipes/layout"

import { useModerateReview, type ModerationInput, type ReviewDetail } from "./reviewQueries"

const MAX_NOTE = 1_000

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "saved"; state: ReviewState }>
  | Readonly<{ kind: "rejected"; message: string; reloadable: boolean }>
  | Readonly<{ kind: "unknown"; serverMessage: string | null }>

const IDLE: Outcome = { kind: "idle" }

const rejectionOf = (error: unknown): Outcome => {
  if (!isApiError(error)) {
    return { kind: "rejected", message: "The change could not be saved. Reload the review and try again.", reloadable: true }
  }
  return { kind: "rejected", message: error.message, reloadable: error.code === "STATE_CONFLICT" }
}

const suggestedState = (current: ReviewState): ReviewState => (current === "new" ? "read" : current)

export type ReviewModerationFormProps = Readonly<{
  review: ReviewDetail
  reloading: boolean
  onReload: () => Promise<ReviewDetail | null>
}>

export const ReviewModerationForm = ({ review, reloading, onReload }: ReviewModerationFormProps): React.ReactElement => {
  const moderate = useModerateReview(review.id)
  const [state, setState] = useState<ReviewState>(suggestedState(review.state))
  const [note, setNote] = useState(review.moderationNote ?? "")
  const [baseVersion, setBaseVersion] = useState(review.version)
  const [held, setHeld] = useState<ModerationInput | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)

  const trimmed = note.trim()
  const nextNote = trimmed === "" ? null : trimmed
  const unknown = outcome.kind === "unknown"
  const locked = moderate.isPending || unknown
  const unchanged = state === review.state && nextNote === review.moderationNote

  const send = (attempt: ModerationInput): void => {
    setHeld(attempt)
    setOutcome(IDLE)
    moderate.mutate(attempt, {
      onSuccess: (saved) => {
        setHeld(null)
        setBaseVersion(saved.version)
        setOutcome({ kind: "saved", state: saved.state })
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
    if (unchanged || locked) return
    send({ state, moderationNote: nextNote, expectedVersion: baseVersion, idempotencyKey: mintIdempotencyKey() })
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
      disabled={moderate.isPending}
      loading={reloading}
      onClick={() => {
        void reload()
      }}
    >
      Reload the review
    </Button>
  )

  return (
    <div className={STACK_LG}>
      {outcome.kind === "saved" ? (
        <Alert tone="success" title="Saved">
          {`The review is now ${reviewState(outcome.state).label}. The client is not notified and sees no change.`}
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
                loading={moderate.isPending}
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
          {`The change did not arrive, so it is not known whether it was saved. Check again repeats the same change and cannot apply it twice. Reload the review to see where it stands; any change after that is a new one. ${outcome.serverMessage ?? ""}`.trim()}
        </Alert>
      ) : null}

      <div className={FIELD_MEASURE}>
        <div className={STACK_LG}>
          <FormField label="State" required>
            {({ id }) => (
              <Select
                id={id}
                options={REVIEW_STATE_OPTIONS}
                value={state}
                disabled={locked}
                onChange={(event) => {
                  if (isReviewState(event.target.value)) setState(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField
            label="Note for administrators (optional)"
            hint={
              unchanged
                ? "Change the state or the note to save."
                : `${String(MAX_NOTE - trimmed.length)} characters left. Clients never see this note.`
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
          <Button loading={moderate.isPending} disabled={unchanged} onClick={submit} trailing>
            Save
          </Button>
        </div>
      )}
    </div>
  )
}
