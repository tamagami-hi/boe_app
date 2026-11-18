import { useState } from "react"

import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { useFundNames } from "~/features/admin/shared/fundNames"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow, Prose } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { Select } from "~/ui/primitives/Select"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { ListSkeleton } from "./ListSkeleton"
import { LinkRefusal, type SentLink } from "./RecordingCategoryLabels"
import {
  useClientRecordings,
  useLinkSipMonths,
  useMarkRecordingOneTime,
  type AdminClientRecordingItem,
} from "./recordingCategoryQueries"
import { sipMonthLabel } from "./sipMonthLink"
import { unpaidMonthsOf } from "./sipScheduleMonths"
import { useClientSipSchedules, type AdminSipScheduleItem } from "./sipScheduleQueries"

const UNSENT = "The category could not be sent. Reload the recordings and try again."
const NO_MONTH = ""

type Ask =
  | Readonly<{ kind: "one_time"; recording: AdminClientRecordingItem }>
  | Readonly<{ kind: "sip"; recording: AdminClientRecordingItem; schedule: AdminSipScheduleItem; month: string }>

const dated = (isoDate: string): string => formatDate(`${isoDate}T00:00:00Z`)

export type RecordingCategoryPanelProps = Readonly<{ userId: string; investorLabel: string }>

export const RecordingCategoryPanel = ({ userId, investorLabel }: RecordingCategoryPanelProps): React.ReactElement => {
  const recordings = useClientRecordings(userId)
  const schedules = useClientSipSchedules(userId)
  const funds = useFundNames()
  const oneTime = useHeldWrite(useMarkRecordingOneTime(userId), UNSENT)
  const link = useHeldWrite(useLinkSipMonths(userId), UNSENT)
  const [months, setMonths] = useState<Readonly<Record<string, string>>>({})
  const [asking, setAsking] = useState<Ask | null>(null)
  const [sentLinks, setSentLinks] = useState<readonly SentLink[]>([])
  const busy =
    oneTime.pending || link.pending || oneTime.outcome.kind === "unknown" || link.outcome.kind === "unknown"

  const reload = (): void => {
    void recordings.refetch()
    void schedules.refetch()
  }

  const activeScheduleFor = (fundId: string): AdminSipScheduleItem | null =>
    schedules.data?.items.find((item) => item.fundId === fundId && item.state === "active") ?? null

  const confirm = (): void => {
    const ask = asking
    setAsking(null)
    if (ask === null) return
    if (ask.kind === "one_time") {
      oneTime.submit({ entryId: ask.recording.entryId })
      return
    }
    const links = [{ month: ask.month, entryId: ask.recording.entryId }]
    setSentLinks(links)
    link.submit({ scheduleId: ask.schedule.scheduleId, links })
  }

  const sipCell = (recording: AdminClientRecordingItem): React.ReactElement => {
    const schedule = activeScheduleFor(recording.fundId)
    if (schedules.isError) return <span className={META_TEXT}>SIP schedules not loaded</span>
    if (schedule === null) return <span className={META_TEXT}>No active SIP schedule for this fund</span>
    const open = unpaidMonthsOf(schedule)
    if (open.length === 0) return <span className={META_TEXT}>Every month of the schedule is linked</span>
    const chosen = months[recording.entryId] ?? NO_MONTH
    return (
      <span className={ACTION_ROW}>
        <Select
          aria-label={`SIP month for the recording dated ${dated(recording.effectiveDate)}`}
          options={[
            { value: NO_MONTH, label: "Choose a month" },
            ...open.map((month) => ({ value: month, label: sipMonthLabel(schedule, month) })),
          ]}
          value={chosen}
          disabled={busy}
          onChange={(event) => {
            setMonths((current) => ({ ...current, [recording.entryId]: event.target.value }))
          }}
        />
        <Button
          size="sm"
          tone="secondary"
          disabled={busy || chosen === NO_MONTH}
          onClick={() => {
            setAsking({ kind: "sip", recording, schedule, month: chosen })
          }}
        >
          Mark as SIP
        </Button>
      </span>
    )
  }

  const oneTimeCell = (recording: AdminClientRecordingItem): React.ReactElement =>
    recording.oneTimeAllowed ? (
      <Button
        size="sm"
        tone="ghost"
        disabled={busy}
        onClick={() => {
          setAsking({ kind: "one_time", recording })
        }}
      >
        Mark as one-time
      </Button>
    ) : (
      <span className={META_TEXT}>One-time</span>
    )

  return (
    <Section
      title="Earlier recordings without a SIP month"
      description="Give each earlier investment its category: a SIP payment, linked to a month of the client's SIP schedule for that fund, or a one-time investment. The amount and date never change, and the client gets no email for this."
    >
      {link.outcome.kind === "done" ? (
        <Alert tone="success" title="Marked as a SIP payment">
          {`The client now sees ${String(link.outcome.result.schedule.monthsPaid)} of ${String(link.outcome.result.schedule.monthCount)} months paid.`}
        </Alert>
      ) : link.outcome.kind === "rejected" ? (
        <LinkRefusal outcome={link.outcome} links={sentLinks} />
      ) : (
        <HeldWriteNotice write={link} subject="the recording was linked" onReload={reload} reloadLabel="Reload the recordings" />
      )}
      {oneTime.outcome.kind === "done" ? (
        <Alert tone="success" title="Marked as a one-time investment">
          The client sees it labelled One-time investment on the receipt.
        </Alert>
      ) : (
        <HeldWriteNotice write={oneTime} subject="the category was set" onReload={reload} reloadLabel="Reload the recordings" />
      )}
      <AsyncBoundary
        query={recordings}
        skeleton={<ListSkeleton />}
        isEmpty={(data) => !data.items.some((item) => item.sipLinkAllowed)}
        empty={
          <Card>
            <p className={PROSE_SM}>Every earlier investment of this client is linked to a SIP month.</p>
          </Card>
        }
      >
        {(data) => (
          <AdminTable
            caption="Earlier recordings without a SIP month, oldest first"
            rows={data.items.filter((item) => item.sipLinkAllowed)}
            rowKey={(row) => row.entryId}
            columns={[
              { key: "date", header: "Dated", render: (row) => dated(row.effectiveDate) },
              { key: "fund", header: "Fund", render: (row) => funds.nameOf(row.fundId) },
              {
                key: "amount",
                header: "Amount",
                numeric: true,
                render: (row) => <MoneyValue amount={toPaise(row.amountPaise)} size="sm" showDecimals />,
              },
              { key: "label", header: "Recorded as", render: (row) => row.categoryLabel },
              { key: "sip", header: "SIP month", render: sipCell },
              { key: "one-time", header: "One-time", render: oneTimeCell },
            ]}
          />
        )}
      </AsyncBoundary>
      <ConfirmDialog
        open={asking !== null}
        title={asking?.kind === "sip" ? "Mark this recording as a SIP payment?" : "Mark this recording as a one-time investment?"}
        confirmLabel={asking?.kind === "sip" ? "Link to the month" : "Mark as one-time"}
        onConfirm={confirm}
        onCancel={() => {
          setAsking(null)
        }}
      >
        {asking === null ? null : (
          <>
            <DataList>
              <DetailRow label="Investor">{investorLabel}</DetailRow>
              <DetailRow label="Fund">{funds.nameOf(asking.recording.fundId)}</DetailRow>
              <DetailRow label="Amount" emphasis="lead">
                <MoneyValue amount={toPaise(asking.recording.amountPaise)} size="sm" showDecimals />
              </DetailRow>
              <DetailRow label="Dated">{dated(asking.recording.effectiveDate)}</DetailRow>
              {asking.kind === "sip" ? (
                <DetailRow label="SIP month">{sipMonthLabel(asking.schedule, asking.month)}</DetailRow>
              ) : null}
            </DataList>
            <Prose>
              {asking.kind === "sip"
                ? "The recording counts as this month of the SIP, and the client sees one more month paid. A linked month stays linked unless the recording is reversed. No email is sent."
                : "The recording is labelled One-time investment for the client. It can still be linked to a SIP month later. No email is sent."}
            </Prose>
          </>
        )}
      </ConfirmDialog>
    </Section>
  )
}
