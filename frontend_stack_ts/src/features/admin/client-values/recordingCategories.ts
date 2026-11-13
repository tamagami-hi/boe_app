import type { AdminRecordingReasonCode } from "@beonedge/contracts"

export type RecordingCategoryCopy = Readonly<{
  value: AdminRecordingReasonCode
  label: string
  amountHint: string
  dateLabel: string
  dateHint: string
  futureDateError: string
  recordedTitle: string
  confirmTitle: string
  confirmLabel: string
  confirmBody: string
}>

const NOT_A_CHARGE =
  "It does not charge the client or start a payment, and it is not growth: what they invested and its current value both rise by this amount."

const REVERSAL_NOTE = "A mistake is corrected later with a reversal, not by editing."

const EARLIER_INVESTMENT: RecordingCategoryCopy = {
  value: "recorded_offline_investment",
  label: "Earlier investment",
  amountHint:
    "The original amount invested, not including any growth since. Up to two decimal places, for example 250000 or 250000.50.",
  dateLabel: "Date of the investment",
  dateHint: "The real date the money was invested. It decides which statement period the entry lands in.",
  futureDateError: "An investment cannot be dated in the future.",
  recordedTitle: "Earlier investment recorded",
  confirmTitle: "Record this earlier investment?",
  confirmLabel: "Record the investment",
  confirmBody: `This records an investment the client has already paid to BeOnEdge. ${NOT_A_CHARGE} The client is notified and sees a receipt labelled Earlier investment. ${REVERSAL_NOTE}`,
}

const MONTHLY_INVESTMENT: RecordingCategoryCopy = {
  value: "recorded_offline_monthly_investment",
  label: "Monthly investment",
  amountHint: "The amount the client paid for this month. Up to two decimal places, for example 5000 or 5000.50.",
  dateLabel: "Date of the payment",
  dateHint: "The date the client paid this month's investment. It decides which statement period the entry lands in.",
  futureDateError: "A payment cannot be dated in the future.",
  recordedTitle: "Monthly investment recorded",
  confirmTitle: "Record this monthly investment?",
  confirmLabel: "Record the investment",
  confirmBody: `This records a monthly investment the client paid to BeOnEdge directly. ${NOT_A_CHARGE} The client is notified and sees a receipt labelled Monthly investment. ${REVERSAL_NOTE}`,
}

const CORRECTION: RecordingCategoryCopy = {
  value: "recorded_offline_correction",
  label: "Correction",
  amountHint:
    "The amount missing from the client's record. A correction can only add: to remove an amount, reverse the wrong entry instead.",
  dateLabel: "Date the correction applies from",
  dateHint: "The date the missing amount should count from. It decides which statement period the entry lands in.",
  futureDateError: "A correction cannot be dated in the future.",
  recordedTitle: "Correction recorded",
  confirmTitle: "Record this correction?",
  confirmLabel: "Record the correction",
  confirmBody: `This adds an amount that is missing from the client's record. ${NOT_A_CHARGE} The client is notified and sees a receipt labelled Correction. ${REVERSAL_NOTE}`,
}

export const RECORDING_CATEGORIES: readonly RecordingCategoryCopy[] = [EARLIER_INVESTMENT, MONTHLY_INVESTMENT, CORRECTION]

export const DEFAULT_RECORDING_REASON: AdminRecordingReasonCode = EARLIER_INVESTMENT.value

export const recordingCategoryCopy = (value: AdminRecordingReasonCode): RecordingCategoryCopy =>
  RECORDING_CATEGORIES.find((category) => category.value === value) ?? EARLIER_INVESTMENT

export const isRecordingReason = (value: string): value is AdminRecordingReasonCode =>
  RECORDING_CATEGORIES.some((category) => category.value === value)
