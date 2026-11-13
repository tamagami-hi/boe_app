import { assertNever } from "~/lib/assertNever"

import type { StatusPresentation } from "./status"

export const MAX_REVIEW_COMMENT = 1_000

export type RatingValue = "1" | "2" | "3" | "4" | "5"

const RATING_WORDS: Readonly<Record<RatingValue, string>> = {
  "1": "Very poor",
  "2": "Poor",
  "3": "Fair",
  "4": "Good",
  "5": "Excellent",
}

const RATING_VALUES: readonly RatingValue[] = ["5", "4", "3", "2", "1"]

export const isRatingValue = (value: string): value is RatingValue =>
  (RATING_VALUES as readonly string[]).includes(value)

export const ratingText = (rating: number): string => {
  const key = String(rating)
  return isRatingValue(key) ? `${key} out of 5, ${RATING_WORDS[key]}` : `${key} out of 5`
}

export const RATING_OPTIONS = RATING_VALUES.map((value) => ({
  value,
  label: `${value} out of 5`,
  hint: RATING_WORDS[value],
}))

export type ReviewState = "new" | "read" | "hidden"

const REVIEW_STATES: readonly ReviewState[] = ["new", "read", "hidden"]

export const isReviewState = (value: string): value is ReviewState =>
  (REVIEW_STATES as readonly string[]).includes(value)

export const reviewState = (value: ReviewState): StatusPresentation => {
  switch (value) {
    case "new":
      return { label: "New", tone: "info" }
    case "read":
      return { label: "Read", tone: "neutral" }
    case "hidden":
      return { label: "Set aside", tone: "warning" }
    default:
      return assertNever(value)
  }
}

export const REVIEW_STATE_OPTIONS = REVIEW_STATES.map((value) => ({ value, label: reviewState(value).label }))
