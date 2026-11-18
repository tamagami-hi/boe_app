import type { UseQueryResult } from "@tanstack/react-query"

import { formatYearMonth } from "~/domain/dates"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"

import type { AdminClientRecordingItem, AdminClientRecordings } from "./recordingCategoryQueries"

export const assignedLabelOf = (recording: AdminClientRecordingItem): string | null => {
  if (recording.category === null) return null
  return recording.sipMonth === null
    ? recording.categoryLabel
    : `${recording.categoryLabel}, ${formatYearMonth(recording.sipMonth)}`
}

export const assignedLabels = (query: UseQueryResult<AdminClientRecordings>): ReadonlyMap<string, string> =>
  new Map(
    (query.data?.items ?? []).flatMap((recording) => {
      const label = assignedLabelOf(recording)
      return label === null ? [] : [[recording.entryId, label] as const]
    }),
  )

export type RecordingCategoryFailureProps = Readonly<{ query: Pick<UseQueryResult, "isError" | "isFetching" | "refetch"> }>

export const RecordingCategoryFailure = ({ query }: RecordingCategoryFailureProps): React.ReactElement | null =>
  query.isError ? (
    <Alert
      tone="warning"
      title="Categories not loaded"
      action={
        <Button
          size="sm"
          tone="secondary"
          loading={query.isFetching}
          onClick={() => {
            void query.refetch()
          }}
        >
          Try again
        </Button>
      }
    >
      It could not be checked which recordings are SIP payments or one-time investments, so the reason they were recorded with
      shows instead.
    </Alert>
  ) : null

const LINK_FIELD = /^links\.(\d+)\.(month|entryId)$/u

export type SentLink = Readonly<{ month: string; entryId: string }>

export const linkRefusalLines = (
  fields: Readonly<Record<string, readonly string[]>>,
  links: readonly SentLink[],
): readonly string[] =>
  Object.entries(fields).flatMap(([field, messages]) => {
    const match = LINK_FIELD.exec(field)
    const link = match === null ? undefined : links[Number(match[1])]
    const subject = match?.[2] === "month" ? "the month" : "the recording"
    const prefix = link === undefined ? "" : `${formatYearMonth(link.month)}: ${subject} `
    return messages.map((message) => `${prefix}${message}.`)
  })

export type LinkRefusalProps = Readonly<{
  outcome: Readonly<{ kind: string; message?: string; fields?: Readonly<Record<string, readonly string[]>> }>
  links: readonly SentLink[]
}>

export const LinkRefusal = ({ outcome, links }: LinkRefusalProps): React.ReactElement | null => {
  if (outcome.kind !== "rejected") return null
  const lines = linkRefusalLines(outcome.fields ?? {}, links)
  return (
    <Alert tone="error" title="Nothing changed">
      {lines.length === 0 ? (outcome.message ?? "") : lines.join(" ")}
    </Alert>
  )
}
