import { useState } from "react"

import { SubmitClientReviewBody } from "@beonedge/contracts"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { MAX_REVIEW_COMMENT, type RatingValue } from "~/domain/reviews"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField } from "~/ui/primitives/FormField"
import { Textarea } from "~/ui/primitives/Textarea"
import { ACTION_ROW } from "~/ui/recipes/layout"

import { RatingControl } from "./RatingControl"
import { useReviewArrivalCheck, useSubmitReview, type ReviewArrival, type ReviewInput } from "./reviewQueries"

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "unknown"; sent: ReviewInput; knownId: string | null }>
  | Readonly<{ kind: "notArrived" }>

const IDLE: Outcome = { kind: "idle" }

const COMMENT_RULE = "Use ordinary visible text, up to 1,000 characters."

const rejectionMessage = (error: unknown): string => {
  if (!isApiError(error)) return "Your review was not sent. Try again."
  if (error.code === "VALIDATION_FAILED") return `Your review was not sent. ${COMMENT_RULE}`
  return error.message
}

export type ReviewOutcome = "sent" | "existing"

const isOurReview = (arrival: ReviewArrival, sent: ReviewInput, knownId: string | null): boolean =>
  !arrival.canSubmit &&
  arrival.latest !== null &&
  arrival.latest.id !== knownId &&
  arrival.latest.rating === sent.rating &&
  arrival.latest.comment === sent.comment

type Props = Readonly<{ latestKnownId: string | null; onOutcome: (outcome: ReviewOutcome) => void }>

export const ReviewForm = ({ latestKnownId, onOutcome }: Props): React.ReactElement => {
  const submit = useSubmitReview()
  const check = useReviewArrivalCheck()
  const [rating, setRating] = useState<RatingValue | null>(null)
  const [comment, setComment] = useState("")
  const [attempted, setAttempted] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)

  const trimmed = comment.trim()
  const input: ReviewInput | null = rating === null ? null : { rating: Number(rating), comment: trimmed === "" ? null : trimmed }
  const commentValid = trimmed === "" || SubmitClientReviewBody.shape.comment.safeParse(trimmed).success
  const ratingError = attempted && rating === null ? "Choose a rating from 1 to 5." : undefined
  const commentError = attempted && !commentValid ? COMMENT_RULE : undefined
  const unknown = outcome.kind === "unknown"
  const locked = submit.isPending || unknown

  const send = (): void => {
    setAttempted(true)
    if (input === null || !commentValid || locked) return
    setOutcome(IDLE)
    const sent = input
    const knownId = latestKnownId
    submit.mutate(sent, {
      onSuccess: () => {
        onOutcome("sent")
      },
      onError: (error) => {
        if (isUnknownWriteOutcome(error)) {
          setOutcome({ kind: "unknown", sent, knownId })
          return
        }
        if (isApiError(error) && error.code === "STATE_CONFLICT") {
          onOutcome("existing")
          return
        }
        setOutcome({ kind: "rejected", message: rejectionMessage(error) })
      },
    })
  }

  const checkArrival = (sent: ReviewInput, knownId: string | null): void => {
    check.mutate(undefined, {
      onSuccess: (arrival) => {
        if (isOurReview(arrival, sent, knownId)) {
          onOutcome("sent")
          return
        }
        if (!arrival.canSubmit) {
          onOutcome("existing")
          return
        }
        setOutcome({ kind: "notArrived" })
      },
    })
  }

  return (
    <Form
      onSubmit={send}
      actions={
        unknown ? null : (
          <Button type="submit" loading={submit.isPending} disabled={locked} trailing>
            Send review
          </Button>
        )
      }
    >
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Review not sent">
          {outcome.message}
        </Alert>
      ) : null}
      {outcome.kind === "notArrived" ? (
        <Alert tone="info" title="Your review did not arrive">
          Your rating and comment are still here. Send them again when you are ready.
        </Alert>
      ) : null}
      {outcome.kind === "unknown" ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button
                size="sm"
                loading={check.isPending}
                onClick={() => {
                  checkArrival(outcome.sent, outcome.knownId)
                }}
              >
                Check my reviews
              </Button>
            </span>
          }
        >
          {check.isError
            ? "We still could not reach BeOnEdge. Check your connection, then check your reviews again."
            : "The connection dropped before BeOnEdge confirmed your review, so it may or may not have arrived. Check your reviews before sending it again. You can only share one review a month, so it cannot be added twice."}
        </Alert>
      ) : null}

      <RatingControl value={rating} error={ratingError} disabled={locked} onChange={setRating} />

      <FormField
        label="Comment (optional)"
        hint={commentError === undefined ? `${String(MAX_REVIEW_COMMENT - trimmed.length)} characters left` : undefined}
        error={commentError}
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            maxLength={MAX_REVIEW_COMMENT}
            value={comment}
            disabled={locked}
            onChange={(event) => {
              setComment(event.target.value)
            }}
          />
        )}
      </FormField>
    </Form>
  )
}
