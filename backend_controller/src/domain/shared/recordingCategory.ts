export const RECORDING_REASON_CODES = [
  "recorded_offline_investment",
  "recorded_offline_monthly_investment",
  "recorded_offline_correction",
] as const

export type RecordingReasonCode = (typeof RECORDING_REASON_CODES)[number]

export type RecordingCategory = "earlier_investment" | "monthly_investment" | "correction"

export interface RecordingCategoryText {
  readonly label: string
  readonly notificationTitle: string
  readonly notificationBody: (fundName: string) => string
}

const CATEGORY_BY_REASON_CODE: ReadonlyMap<string, RecordingCategory> = new Map<
  RecordingReasonCode,
  RecordingCategory
>([
  ["recorded_offline_investment", "earlier_investment"],
  ["recorded_offline_monthly_investment", "monthly_investment"],
  ["recorded_offline_correction", "correction"],
])

const DEFAULT_CATEGORY: RecordingCategory = "earlier_investment"

export const RECORDING_CATEGORY_TEXT: Readonly<Record<RecordingCategory, RecordingCategoryText>> =
  Object.freeze({
    earlier_investment: {
      label: "Earlier investment",
      notificationTitle: "Investment added",
      notificationBody: (fundName) =>
        `Your earlier investment in ${fundName} is now in your portfolio. Contact support if you do not recognise it.`,
    },
    monthly_investment: {
      label: "Monthly investment",
      notificationTitle: "Investment added",
      notificationBody: (fundName) =>
        `Your monthly investment in ${fundName} is now in your portfolio. Contact support if you do not recognise it.`,
    },
    correction: {
      label: "Correction",
      notificationTitle: "Investment record corrected",
      notificationBody: (fundName) =>
        `Your ${fundName} record now includes a correction. Contact support if you have any questions.`,
    },
  })

export const recordingCategoryOf = (reasonCode: string): RecordingCategory =>
  CATEGORY_BY_REASON_CODE.get(reasonCode) ?? DEFAULT_CATEGORY
