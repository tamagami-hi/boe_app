import type { AdminAssignedRecordingCategory, AdminRecordingReasonCode } from "@beonedge/contracts"

export type RecordingKind = "sip" | "one_time" | "correction"

export type RecordingCategoryCopy = Readonly<{
  value: RecordingKind
  reasonCode: AdminRecordingReasonCode
  category: AdminAssignedRecordingCategory | null
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

const SIP_PAYMENT: RecordingCategoryCopy = {
  value: "sip",
  reasonCode: "recorded_offline_monthly_investment",
  category: "sip",
  label: "SIP payment",
  amountHint: "The amount the client paid for this SIP month. Up to two decimal places, for example 5000 or 5000.50.",
  dateLabel: "Date of the payment",
  dateHint: "The date the client paid this month's investment. It decides which statement period the entry lands in.",
  futureDateError: "A payment cannot be dated in the future.",
  recordedTitle: "SIP payment recorded",
  confirmTitle: "Record this SIP payment?",
  confirmLabel: "Record the payment",
  confirmBody: `This records a SIP payment the client paid to BeOnEdge directly, for the schedule month below. ${NOT_A_CHARGE} The client is notified in the app and by email with the SIP month, and sees a receipt labelled SIP payment. ${REVERSAL_NOTE}`,
}

const ONE_TIME_INVESTMENT: RecordingCategoryCopy = {
  value: "one_time",
  reasonCode: "recorded_offline_investment",
  category: "one_time",
  label: "One-time investment",
  amountHint:
    "The original amount invested, not including any growth since. Up to two decimal places, for example 250000 or 250000.50.",
  dateLabel: "Date of the investment",
  dateHint: "The real date the money was invested. It decides which statement period the entry lands in.",
  futureDateError: "An investment cannot be dated in the future.",
  recordedTitle: "One-time investment recorded",
  confirmTitle: "Record this one-time investment?",
  confirmLabel: "Record the investment",
  confirmBody: `This records a one-time investment the client has already paid to BeOnEdge. ${NOT_A_CHARGE} The client is notified in the app and by email, and sees a receipt labelled One-time investment. ${REVERSAL_NOTE}`,
}

const CORRECTION: RecordingCategoryCopy = {
  value: "correction",
  reasonCode: "recorded_offline_correction",
  category: null,
  label: "Correction",
  amountHint:
    "The amount missing from the client's record. A correction can only add: to remove an amount, reverse the wrong entry instead.",
  dateLabel: "Date the correction applies from",
  dateHint: "The date the missing amount should count from. It decides which statement period the entry lands in.",
  futureDateError: "A correction cannot be dated in the future.",
  recordedTitle: "Correction recorded",
  confirmTitle: "Record this correction?",
  confirmLabel: "Record the correction",
  confirmBody: `This adds an amount that is missing from the client's record. ${NOT_A_CHARGE} The client is notified in the app, not by email, and sees a receipt labelled Correction. ${REVERSAL_NOTE}`,
}

export const RECORDING_CATEGORIES: readonly RecordingCategoryCopy[] = [ONE_TIME_INVESTMENT, SIP_PAYMENT, CORRECTION]

export const DEFAULT_RECORDING_KIND: RecordingKind = ONE_TIME_INVESTMENT.value

export const recordingCategoryCopy = (value: RecordingKind): RecordingCategoryCopy =>
  RECORDING_CATEGORIES.find((category) => category.value === value) ?? ONE_TIME_INVESTMENT

export const isRecordingKind = (value: string): value is RecordingKind =>
  RECORDING_CATEGORIES.some((category) => category.value === value)

export type HeldRecordingShape = Readonly<{
  reasonCode: AdminRecordingReasonCode
  category?: AdminAssignedRecordingCategory | undefined
  sipScheduleLink?: unknown
}>

export const recordingKindOf = (body: HeldRecordingShape): RecordingKind => {
  if (body.reasonCode === CORRECTION.reasonCode) return "correction"
  if (body.category === "sip" || body.sipScheduleLink !== undefined) return "sip"
  if (body.category === "one_time") return "one_time"
  return body.reasonCode === SIP_PAYMENT.reasonCode ? "sip" : "one_time"
}
