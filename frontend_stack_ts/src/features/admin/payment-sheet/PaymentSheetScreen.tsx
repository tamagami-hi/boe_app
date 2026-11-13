import { useMemo, useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatYearMonth } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { indiaToday } from "~/features/admin/client-values/indiaToday"
import { ListSkeleton } from "~/features/admin/client-values/ListSkeleton"
import { SIP_MONTH_PATTERN } from "~/features/admin/client-values/sipScheduleMonths"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG } from "~/ui/recipes/layout"

import { canFill, checkDraft, defaultDraft, recordingBodyOf, statusOf } from "./recordingSheet"
import type { RowDraft, SheetSchedule } from "./recordingSheet"
import { matchCsv } from "./recordingSheetCsv"
import type { CsvMatch } from "./recordingSheetCsv"
import { RecordingSheetControls } from "./RecordingSheetControls"
import { RecordingSheetCsvPanel } from "./RecordingSheetCsvPanel"
import { useRecordingSheet, useRefreshAfterRecording, useSendRecording } from "./recordingSheetQueries"
import { RecordingSheetTable } from "./RecordingSheetTable"
import type { SheetRowView } from "./RecordingSheetTable"
import { useRecordingSheetRecorder } from "./useRecordingSheetRecorder"

const SHEET_DESCRIPTION =
  "Record a month of SIP payments in one place. Tick each client who paid, check the amount and the date, and press Record. Every row is its own monthly investment, linked to its schedule month and sent two at a time, so one refusal never blocks the others."

const NO_SCHEDULES: readonly SheetSchedule[] = []

type ReadyRow = Readonly<{ view: SheetRowView; amountPaise: string; effectiveDate: string }>

type SheetMonthProps = Readonly<{
  month: string
  fundId: string
  onMonth: (month: string) => void
  onFund: (fundId: string) => void
}>

const readyRowsOf = (views: readonly SheetRowView[]): readonly ReadyRow[] =>
  views.flatMap((view) =>
    view.draft.selected && canFill(view.status) && view.check.kind === "ready"
      ? [{ view, amountPaise: view.check.amountPaise, effectiveDate: view.check.effectiveDate }]
      : [],
  )

const RecordingSheetMonth = ({ month, fundId, onMonth, onFund }: SheetMonthProps): React.ReactElement => {
  const today = indiaToday()
  const validMonth = SIP_MONTH_PATTERN.test(month)
  const sheet = useRecordingSheet(month, fundId)
  const recorder = useRecordingSheetRecorder(month, useSendRecording(), useRefreshAfterRecording())
  const [drafts, setDrafts] = useState<Readonly<Record<string, RowDraft>>>({})
  const [confirming, setConfirming] = useState(false)

  const schedules = sheet.data?.items ?? NO_SCHEDULES
  const views = useMemo(
    () =>
      schedules.map((schedule): SheetRowView => {
        const draft = drafts[schedule.scheduleId] ?? defaultDraft(schedule, today)
        const entry = recorder.entries.get(schedule.scheduleId)
        return {
          schedule,
          draft,
          check: checkDraft(draft, today),
          entry,
          held: recorder.held.get(schedule.scheduleId),
          status: statusOf(entry, schedule.recorded !== null),
        }
      }),
    [schedules, drafts, recorder.entries, recorder.held, today],
  )
  const ready = readyRowsOf(views)
  const needsAttention = views.filter(
    (view) => view.draft.selected && canFill(view.status) && view.check.kind === "invalid",
  ).length
  const totalPaise = ready.reduce((sum, row) => sum + BigInt(row.amountPaise), 0n).toString()
  const visible = new Set(schedules.map((schedule) => schedule.scheduleId))
  const hiddenHeld = [...recorder.held.keys()].filter((scheduleId) => !visible.has(scheduleId)).length

  const setDraft = (scheduleId: string, draft: RowDraft): void => {
    setDrafts((current) => ({ ...current, [scheduleId]: draft }))
  }

  const fillFromCsv = (text: string): CsvMatch => {
    const byId = new Map(views.map((view) => [view.schedule.scheduleId, view]))
    const match = matchCsv(text, schedules, (scheduleId) => canFill(byId.get(scheduleId)?.status ?? "queued"), today)
    setDrafts((current) =>
      match.fills.reduce<Readonly<Record<string, RowDraft>>>((next, fill) => {
        const view = byId.get(fill.scheduleId)
        const dateText = fill.dateText ?? view?.draft.dateText ?? today
        return { ...next, [fill.scheduleId]: { selected: true, amountText: fill.amountText, dateText } }
      }, current),
    )
    return match
  }

  const recordReady = (): void => {
    setConfirming(false)
    recorder.record(
      ready.map(({ view, amountPaise, effectiveDate }) => ({
        userId: view.schedule.userId,
        body: recordingBodyOf(view.schedule, month, { amountPaise, effectiveDate }),
      })),
    )
  }

  const recordAnother = (scheduleId: string): void => {
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== scheduleId)))
    recorder.recordAnother(scheduleId)
  }

  return (
    <>
      <RecordingSheetControls month={month} fundId={fundId} disabled={recorder.busy} onMonth={onMonth} onFund={onFund} />

      {hiddenHeld === 0 || sheet.data === undefined ? null : (
        <Alert tone="warning" title="Rows waiting for Check again are hidden">
          {`${String(hiddenHeld)} row(s) of this month were sent without a confirmed reply and are not on this sheet. Choose All funds to see them and check them again.`}
        </Alert>
      )}

      {validMonth ? (
        <Section
          title={`Schedules due in ${formatYearMonth(month)}`}
          description="Active SIP schedules whose months include this month. The recorded amount is read from the ledger now."
        >
          <AsyncBoundary
            query={sheet}
            skeleton={<ListSkeleton />}
            isEmpty={(data) => data.items.length === 0}
            empty={
              <EmptyState
                title="No SIP schedule is due this month"
                description="Only active schedules whose months include this month are listed. Add a schedule on the client's page."
              />
            }
          >
            {() => (
              <div className={STACK_LG}>
                <RecordingSheetTable
                  views={views}
                  month={month}
                  today={today}
                  onDraft={setDraft}
                  onCheckAgain={recorder.checkAgain}
                  onRecordAnother={recordAnother}
                />
                <p className={PROSE_SM}>
                  {`${String(ready.length)} row(s) ready to record. ${String(needsAttention)} ticked row(s) need attention.`}
                </p>
                <Button
                  disabled={ready.length === 0 || recorder.busy}
                  loading={recorder.busy}
                  onClick={() => {
                    setConfirming(true)
                  }}
                >
                  Record
                </Button>
                <RecordingSheetCsvPanel disabled={recorder.busy} onFill={fillFromCsv} />
              </div>
            )}
          </AsyncBoundary>
        </Section>
      ) : null}

      <ConfirmDialog
        open={confirming && ready.length > 0}
        title="Record these monthly investments?"
        confirmLabel="Record the payments"
        onConfirm={recordReady}
        onCancel={() => {
          setConfirming(false)
        }}
      >
        <DataList>
          <DetailRow label="Month">{validMonth ? formatYearMonth(month) : month}</DetailRow>
          <DetailRow label="Rows" emphasis="lead">
            {String(ready.length)}
          </DetailRow>
          <DetailRow label="Total">
            <MoneyValue amount={toPaise(totalPaise)} size="sm" showDecimals />
          </DetailRow>
        </DataList>
        <p className={PROSE_SM}>
          Each row is recorded as a monthly investment for its schedule month. Each client is notified that an
          investment was added and is emailed the amount.
        </p>
      </ConfirmDialog>
    </>
  )
}

const PaymentSheetScreen = (): React.ReactElement => {
  const [month, setMonth] = useState(() => indiaToday().slice(0, 7))
  const [fundId, setFundId] = useState("")

  return (
    <Page width="wide">
      <PageHeader title="Monthly payments" description={SHEET_DESCRIPTION} />
      <RecordingSheetMonth key={month} month={month} fundId={fundId} onMonth={setMonth} onFund={setFundId} />
    </Page>
  )
}

export default PaymentSheetScreen
