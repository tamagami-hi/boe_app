import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import type { StatusTone } from "~/domain/status"
import { paiseToRupeeText } from "~/features/admin/client-values/rupeeAmount"
import { monthNumberOf } from "~/features/admin/client-values/sipScheduleMonths"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Input } from "~/ui/primitives/FormField"
import { FIELD_ERROR, FIELD_HINT } from "~/ui/recipes/field"
import { STACK_SM } from "~/ui/recipes/layout"

import type { HeldRecording } from "./heldRecordings"
import { canFill } from "./recordingSheet"
import type { DraftCheck, RowDraft, RowEntry, RowStatus, SheetSchedule } from "./recordingSheet"
import { SheetCheckbox } from "./SheetCheckbox"

export type SheetRowView = Readonly<{
  schedule: SheetSchedule
  status: RowStatus
  draft: RowDraft
  check: DraftCheck
  entry: RowEntry | undefined
  held: HeldRecording | undefined
  unsaved: boolean
}>

export type RecordingSheetTableProps = Readonly<{
  views: readonly SheetRowView[]
  month: string
  today: string
  onDraft: (scheduleId: string, draft: RowDraft) => void
  onCheckAgain: (scheduleId: string) => void
  onRecordAnother: (scheduleId: string) => void
  onReleaseStale: (scheduleId: string) => void
}>

const STATUS_CHIPS: Readonly<Record<RowStatus, Readonly<{ label: string; tone: StatusTone }>>> = {
  pending: { label: "Not sent", tone: "neutral" },
  queued: { label: "Pending", tone: "info" },
  sending: { label: "Sending", tone: "info" },
  recorded: { label: "Recorded", tone: "positive" },
  refused: { label: "Refused", tone: "negative" },
  unknown: { label: "Not confirmed", tone: "warning" },
  unreadable: { label: "Check the record", tone: "warning" },
}

const UNKNOWN_HINT =
  "The reply did not arrive, so it is not known whether this was recorded. Check again sends the same request, and it can only ever apply once."

const UNREADABLE_HINT =
  "A recording held in this tab for this row could not be read back, so it is not known whether it was recorded. Check the client's ledger before recording it again."

const UNSAVED_HINT =
  "Not saved in this tab: this row's request is kept only while the page stays open. Stay on this month until it is confirmed."

const rowLabel = (schedule: SheetSchedule): string => `${schedule.clientName}, ${schedule.fundName}`

const RecordedCell = ({ schedule }: Readonly<{ schedule: SheetSchedule }>): React.ReactElement => {
  if (schedule.recorded === null) return <span className={FIELD_HINT}>Not recorded</span>
  return (
    <div className={STACK_SM}>
      <MoneyValue amount={toPaise(schedule.recorded.amountPaise)} size="sm" showDecimals />
      <span className={FIELD_HINT}>{formatDate(schedule.recorded.effectiveDate)}</span>
    </div>
  )
}

type StatusCellProps = Readonly<{
  view: SheetRowView
  onCheckAgain: (scheduleId: string) => void
  onRecordAnother: (scheduleId: string) => void
  onReleaseStale: (scheduleId: string) => void
}>

const StatusContent = ({ view, onCheckAgain, onRecordAnother, onReleaseStale }: StatusCellProps): React.ReactElement => {
  const { status, entry, schedule } = view
  const chip = STATUS_CHIPS[status]
  return (
    <>
      <Badge tone={chip.tone}>{chip.label}</Badge>
      {entry?.kind === "refused" ? <span className={FIELD_ERROR}>{entry.message}</span> : null}
      {entry?.kind === "recorded" ? (
        <span className={FIELD_HINT}>
          <MoneyValue amount={toPaise(entry.amountPaise)} size="sm" showDecimals /> on {formatDate(entry.effectiveDate)}
        </span>
      ) : null}
      {status === "unknown" ? (
        <>
          <span className={FIELD_HINT}>{UNKNOWN_HINT}</span>
          <Button
            size="sm"
            aria-label={`Check again for ${rowLabel(schedule)}`}
            onClick={() => {
              onCheckAgain(schedule.scheduleId)
            }}
          >
            Check again
          </Button>
        </>
      ) : null}
      {status === "unreadable" ? (
        <>
          <span className={FIELD_HINT}>{UNREADABLE_HINT}</span>
          <Button
            size="sm"
            tone="ghost"
            aria-label={`I have checked the record for ${rowLabel(schedule)}`}
            onClick={() => {
              onReleaseStale(schedule.scheduleId)
            }}
          >
            I have checked the record
          </Button>
        </>
      ) : null}
      {view.unsaved && view.held !== undefined ? <span className={FIELD_ERROR}>{UNSAVED_HINT}</span> : null}
      {status === "recorded" ? (
        <Button
          size="sm"
          tone="ghost"
          aria-label={`Record another for ${rowLabel(schedule)}`}
          onClick={() => {
            onRecordAnother(schedule.scheduleId)
          }}
        >
          Record another
        </Button>
      ) : null}
    </>
  )
}

const StatusCell = (props: StatusCellProps): React.ReactElement => (
  <div className={STACK_SM} aria-live="polite">
    {props.view.status === "pending" && !props.view.draft.selected ? null : <StatusContent {...props} />}
  </div>
)

const errorsOf = (view: SheetRowView): Readonly<{ amount: string | null; date: string | null }> =>
  view.draft.selected && view.check.kind === "invalid" && canFill(view.status)
    ? { amount: view.check.amountError, date: view.check.dateError }
    : { amount: null, date: null }

export const RecordingSheetTable = ({
  views,
  month,
  today,
  onDraft,
  onCheckAgain,
  onRecordAnother,
  onReleaseStale,
}: RecordingSheetTableProps): React.ReactElement => (
  <AdminTable
    caption="SIP schedules due this month"
    rows={views}
    rowKey={(view) => view.schedule.scheduleId}
    columns={[
      {
        key: "record",
        header: "Record",
        render: (view) => (
          <SheetCheckbox
            label={`Record ${rowLabel(view.schedule)}`}
            checked={view.draft.selected && canFill(view.status)}
            disabled={!canFill(view.status)}
            onChange={(selected) => {
              onDraft(view.schedule.scheduleId, { ...view.draft, selected })
            }}
          />
        ),
      },
      {
        key: "client",
        header: "Client",
        render: ({ schedule }) => (
          <div className={STACK_SM}>
            <span>{schedule.clientName}</span>
            <span className={FIELD_HINT}>{schedule.clientEmail}</span>
          </div>
        ),
      },
      {
        key: "fund",
        header: "Fund",
        render: ({ schedule }) => (
          <div className={STACK_SM}>
            <span>{schedule.fundName}</span>
            <span className={FIELD_HINT}>
              {`Month ${String(monthNumberOf({ ...schedule, paidMonths: [] }, month))} of ${String(schedule.monthCount)}`}
            </span>
          </div>
        ),
      },
      {
        key: "expected",
        header: "Expected",
        numeric: true,
        render: ({ schedule }) => <MoneyValue amount={toPaise(schedule.monthlyAmountPaise)} size="sm" showDecimals />,
      },
      {
        key: "recorded",
        header: "Recorded this month",
        render: ({ schedule }) => <RecordedCell schedule={schedule} />,
      },
      {
        key: "amount",
        header: "Amount (₹)",
        render: (view) => {
          const { amount } = errorsOf(view)
          const errorId = `sheet-amount-${view.schedule.scheduleId}`
          return (
            <div className={STACK_SM}>
              <Input
                aria-label={`Amount in rupees for ${rowLabel(view.schedule)}`}
                aria-describedby={amount === null ? undefined : errorId}
                inputMode="decimal"
                autoComplete="off"
                value={view.held === undefined ? view.draft.amountText : paiseToRupeeText(view.held.body.amountPaise)}
                invalid={amount !== null}
                disabled={!canFill(view.status)}
                onChange={(event) => {
                  onDraft(view.schedule.scheduleId, { ...view.draft, amountText: event.target.value })
                }}
              />
              {amount === null ? null : (
                <span id={errorId} className={FIELD_ERROR}>
                  {amount}
                </span>
              )}
            </div>
          )
        },
      },
      {
        key: "date",
        header: "Date",
        render: (view) => {
          const { date } = errorsOf(view)
          const errorId = `sheet-date-${view.schedule.scheduleId}`
          return (
            <div className={STACK_SM}>
              <Input
                type="date"
                max={today}
                aria-label={`Date for ${rowLabel(view.schedule)}`}
                aria-describedby={date === null ? undefined : errorId}
                value={view.held === undefined ? view.draft.dateText : view.held.body.effectiveDate}
                invalid={date !== null}
                disabled={!canFill(view.status)}
                onChange={(event) => {
                  onDraft(view.schedule.scheduleId, { ...view.draft, dateText: event.target.value })
                }}
              />
              {date === null ? null : (
                <span id={errorId} className={FIELD_ERROR}>
                  {date}
                </span>
              )}
            </div>
          )
        },
      },
      {
        key: "status",
        header: "Status",
        render: (view) => (
          <StatusCell
            view={view}
            onCheckAgain={onCheckAgain}
            onRecordAnother={onRecordAnother}
            onReleaseStale={onReleaseStale}
          />
        ),
      },
    ]}
  />
)
