import { useEffect, useState } from "react"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate, formatYearMonth } from "~/domain/dates"
import { formatINR, toPaise } from "~/domain/money"
import { LinkRefusal, type SentLink } from "~/features/admin/client-values/RecordingCategoryLabels"
import {
  useLinkSipMonths,
  useSipLinkProposal,
  type AdminClientRecordingItem,
  type AdminSipLinkProposal,
} from "~/features/admin/client-values/recordingCategoryQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Prose } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Select } from "~/ui/primitives/Select"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

const UNSENT = "The links could not be sent. Reload the schedules and try again."
const LEAVE_OPEN = ""

type Month = AdminSipLinkProposal["months"][number]
type Choices = Readonly<Record<string, string>>

const dated = (isoDate: string): string => formatDate(`${isoDate}T00:00:00Z`)

const recordingText = (recording: AdminClientRecordingItem): string =>
  `${dated(recording.effectiveDate)}, ${formatINR(toPaise(recording.amountPaise), { showDecimals: true })}, ${recording.categoryLabel}`

const proposedChoices = (data: AdminSipLinkProposal): Choices =>
  Object.fromEntries(data.months.flatMap((row) => (row.proposedEntryId === null ? [] : [[row.month, row.proposedEntryId] as const])))

const linksOf = (data: AdminSipLinkProposal, choices: Choices) =>
  data.months.flatMap((row) => {
    const entryId = choices[row.month] ?? LEAVE_OPEN
    return row.paid || entryId === LEAVE_OPEN ? [] : [{ month: row.month, entryId }]
  })

type ProposalTableProps = Readonly<{
  data: AdminSipLinkProposal
  choices: Choices
  locked: boolean
  onChoose: (month: string, entryId: string) => void
}>

const ProposalTable = ({ data, choices, locked, onChoose }: ProposalTableProps): React.ReactElement => {
  const candidates = new Map(data.candidates.map((recording) => [recording.entryId, recording]))
  const takenElsewhere = (month: string): ReadonlySet<string> =>
    new Set(Object.entries(choices).flatMap(([other, entryId]) => (other === month ? [] : [entryId])))

  const recordingCell = (row: Month): React.ReactElement => {
    if (row.paid) return <span className={META_TEXT}>Already linked</span>
    const taken = takenElsewhere(row.month)
    return (
      <Select
        aria-label={`Recording for ${formatYearMonth(row.month)}`}
        options={[
          { value: LEAVE_OPEN, label: "Leave this month open" },
          ...data.candidates
            .filter((recording) => !taken.has(recording.entryId))
            .map((recording) => ({ value: recording.entryId, label: recordingText(recording) })),
        ]}
        value={choices[row.month] ?? LEAVE_OPEN}
        disabled={locked}
        onChange={(event) => {
          onChoose(row.month, event.target.value)
        }}
      />
    )
  }

  const amountCell = (row: Month): React.ReactElement | null => {
    const chosen = candidates.get(choices[row.month] ?? LEAVE_OPEN)
    if (row.paid || chosen === undefined) return null
    return (
      <span className={ACTION_ROW}>
        <MoneyValue amount={toPaise(chosen.amountPaise)} size="sm" showDecimals />
        {chosen.amountPaise === data.schedule.monthlyAmountPaise ? null : <Badge tone="warning">Not the monthly amount</Badge>}
      </span>
    )
  }

  return (
    <AdminTable
      caption="Proposed recording for each month of the schedule"
      rows={data.months}
      rowKey={(row) => row.month}
      columns={[
        { key: "month", header: "Month", render: (row) => `${formatYearMonth(row.month)}, month ${String(row.monthNumber)}` },
        { key: "recording", header: "Recording", render: recordingCell },
        { key: "amount", header: "Amount", render: amountCell },
      ]}
    />
  )
}

export type SipHistoryLinkPanelProps = Readonly<{
  userId: string
  scheduleId: string
  onReload: () => void
  onClose: () => void
  onHoldChange?: (holding: boolean) => void
}>

export const SipHistoryLinkPanel = ({
  userId,
  scheduleId,
  onReload,
  onClose,
  onHoldChange,
}: SipHistoryLinkPanelProps): React.ReactElement => {
  const proposal = useSipLinkProposal(userId, scheduleId)
  const write = useHeldWrite(useLinkSipMonths(userId), UNSENT)
  const [edited, setEdited] = useState<Choices | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sentLinks, setSentLinks] = useState<readonly SentLink[]>([])
  const holding = write.pending || write.outcome.kind === "unknown"

  useEffect(() => {
    onHoldChange?.(holding)
    return () => {
      onHoldChange?.(false)
    }
  }, [holding, onHoldChange])

  if (write.outcome.kind === "done") {
    const { linked, schedule } = write.outcome.result
    return (
      <Alert
        tone="success"
        title="Earlier recordings linked"
        action={
          <Button size="sm" tone="secondary" onClick={onClose}>
            Done
          </Button>
        }
      >
        {`${String(linked)} month(s) linked. The client now sees ${String(schedule.monthsPaid)} of ${String(schedule.monthCount)} months paid.`}
      </Alert>
    )
  }

  return (
    <Card elevated>
      <AsyncBoundary
        query={proposal}
        skeleton={
          <>
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="4rem" />
          </>
        }
      >
        {(data) => {
          const choices = edited ?? proposedChoices(data)
          const links = linksOf(data, choices)
          const paidAfter = data.schedule.monthsPaid + links.length
          return (
            <div className={STACK_LG}>
              <p className={PROSE_SM}>
                The client&apos;s earlier monthly investments in this fund are proposed in month order, each in its own month
                where it fits. Check every row, change or clear it, then confirm. Nothing changes until you confirm, amounts and
                dates stay as recorded, and the client gets no email for this.
              </p>
              {data.candidates.length === 0 ? (
                <p className={PROSE_SM}>This client has no earlier recording in this fund that is free to link.</p>
              ) : (
                <ProposalTable
                  data={data}
                  choices={choices}
                  locked={holding}
                  onChoose={(month, entryId) => {
                    setEdited({ ...choices, [month]: entryId })
                  }}
                />
              )}
              {write.outcome.kind === "rejected" ? (
                <LinkRefusal outcome={write.outcome} links={sentLinks} />
              ) : (
                <HeldWriteNotice write={write} subject="the months were linked" onReload={onReload} />
              )}
              <span className={ACTION_ROW}>
                <Button
                  disabled={holding || links.length === 0}
                  loading={write.pending}
                  onClick={() => {
                    setConfirming(true)
                  }}
                >
                  {`Link ${String(links.length)} month(s)`}
                </Button>
                <Button tone="ghost" disabled={holding} onClick={onClose}>
                  Cancel
                </Button>
              </span>
              <ConfirmDialog
                open={confirming}
                title="Link these recordings to the SIP?"
                confirmLabel="Link the months"
                onConfirm={() => {
                  setConfirming(false)
                  setSentLinks(links)
                  write.submit({ scheduleId, links })
                }}
                onCancel={() => {
                  setConfirming(false)
                }}
              >
                <Prose>
                  {`${String(links.length)} recording(s) are linked to their months. The client then sees ${String(paidAfter)} of ${String(data.schedule.monthCount)} months paid. A linked month stays linked unless its recording is reversed. No email is sent.`}
                </Prose>
              </ConfirmDialog>
            </div>
          )
        }}
      </AsyncBoundary>
    </Card>
  )
}
