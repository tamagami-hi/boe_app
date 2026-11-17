import { useState } from "react"

import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, formatYearMonth, indiaToday } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useClientSipEarlyExits } from "~/features/admin/client-values/earlyExitQueries"
import { thisMonthStatus } from "~/features/admin/client-values/recordingPrefill"
import { SipEarlyExitList } from "~/features/admin/client-values/SipEarlyExitList"
import { useClientSipSchedules, type AdminSipScheduleItem } from "~/features/admin/client-values/sipScheduleQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { SipEarlyExitPanel } from "./SipEarlyExitPanel"
import { SipScheduleCreateForm } from "./SipScheduleCreateForm"
import { SipScheduleEditor } from "./SipScheduleEditor"

const MONTH_NOTE = {
  paid: "This month is already recorded.",
  outside: "This month is outside the schedule.",
} as const

type RecordMonthActionProps = Readonly<{
  schedule: AdminSipScheduleItem
  blocked: boolean
  onRecord: (schedule: AdminSipScheduleItem) => void
}>

const RecordMonthAction = ({ schedule, blocked, onRecord }: RecordMonthActionProps): React.ReactElement => {
  const status = thisMonthStatus(schedule, indiaToday())
  if (status !== "unpaid") return <span className={META_TEXT}>{MONTH_NOTE[status]}</span>
  return (
    <Button
      size="sm"
      tone="secondary"
      disabled={blocked}
      onClick={() => {
        onRecord(schedule)
      }}
    >
      Record this month
    </Button>
  )
}

const StateBadge = ({ state, closedEarlyOn }: Readonly<{ state: string; closedEarlyOn: string | undefined }>): React.ReactElement => {
  if (state === "active") return <Badge tone="positive">Active</Badge>
  if (closedEarlyOn === undefined) return <Badge tone="neutral">Closed</Badge>
  return <Badge tone="neutral">{`Closed early on ${formatDate(`${closedEarlyOn}T00:00:00Z`)}`}</Badge>
}

export type SipScheduleSectionProps = Readonly<{
  userId: string
  investorLabel: string
  canStart: boolean
  onRecordMonth?: (schedule: AdminSipScheduleItem) => void
  isRecordBlocked?: boolean
}>

export const SipScheduleSection = ({
  userId,
  investorLabel,
  canStart,
  onRecordMonth,
  isRecordBlocked = false,
}: SipScheduleSectionProps): React.ReactElement | null => {
  const { hasAnyPermission } = useSession()
  const canRead = hasAnyPermission(["client_position.write", "client_values.read"])
  const canWrite = hasAnyPermission(["client_position.write"])
  const schedules = useClientSipSchedules(canRead ? userId : "")
  const earlyExits = useClientSipEarlyExits(canRead ? userId : "")
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [exitingId, setExitingId] = useState<string | null>(null)
  const [isPanelHolding, setPanelHolding] = useState(false)
  if (!canRead) return null

  const reload = (): void => {
    void schedules.refetch()
    void earlyExits.refetch()
  }
  const closedEarlyOn = new Map((earlyExits.data?.items ?? []).map((item) => [item.scheduleId, item.effectiveDate]))
  const editing = schedules.data?.items.find((item) => item.scheduleId === editingId)
  const canRecordMonth = canWrite && canStart && onRecordMonth !== undefined

  return (
    <>
      <Section
        title="SIP schedules"
        description="Monthly investments the client pays BeOnEdge directly. Nothing is collected automatically: each monthly investment you record can be linked to one month, and the client sees how many months are paid."
        actions={
          canWrite && canStart && !creating ? (
            <Button
              size="sm"
              tone="secondary"
              onClick={() => {
                setCreating(true)
              }}
            >
              Start a SIP schedule
            </Button>
          ) : null
        }
      >
        {creating ? (
          <SipScheduleCreateForm
            userId={userId}
            onReload={reload}
            onClose={() => {
              setCreating(false)
            }}
          />
        ) : null}

        <AsyncBoundary
          query={schedules}
          skeleton={
            <Card>
              <Skeleton height="1rem" width="40%" />
              <Skeleton height="2rem" />
            </Card>
          }
          isEmpty={(data) => data.items.length === 0}
          empty={
            <Card>
              <p className={PROSE_SM}>This client has no SIP schedule.</p>
            </Card>
          }
        >
          {(data) => (
            <AdminTable
              caption="SIP schedules"
              rows={data.items}
              rowKey={(row) => row.scheduleId}
              columns={[
                { key: "fund", header: "Fund", render: (row) => row.fundName },
                {
                  key: "amount",
                  header: "Monthly",
                  numeric: true,
                  render: (row) => <MoneyValue amount={toPaise(row.monthlyAmountPaise)} size="sm" showDecimals />,
                },
                {
                  key: "months",
                  header: "Months",
                  render: (row) => `${formatYearMonth(row.startMonth)} to ${formatYearMonth(row.endMonth)}`,
                },
                {
                  key: "paid",
                  header: "Paid",
                  render: (row) => `${String(row.monthsPaid)} of ${String(row.monthCount)}`,
                },
                {
                  key: "due",
                  header: "Unpaid to date",
                  numeric: true,
                  render: (row) => String(row.monthsDue),
                },
                {
                  key: "state",
                  header: "State",
                  render: (row) => <StateBadge state={row.state} closedEarlyOn={closedEarlyOn.get(row.scheduleId)} />,
                },
                {
                  key: "manage",
                  header: "",
                  render: (row) =>
                    canWrite ? (
                      <span className={ACTION_ROW}>
                        {canRecordMonth && row.state === "active" ? (
                          <RecordMonthAction schedule={row} blocked={isRecordBlocked} onRecord={onRecordMonth} />
                        ) : null}
                        <Button
                          size="sm"
                          tone="ghost"
                          disabled={isPanelHolding}
                          onClick={() => {
                            setExitingId(null)
                            setEditingId(row.scheduleId)
                          }}
                        >
                          Manage
                        </Button>
                        {row.state === "active" ? (
                          <Button
                            size="sm"
                            tone="ghost"
                            disabled={isPanelHolding}
                            onClick={() => {
                              setEditingId(null)
                              setExitingId(row.scheduleId)
                            }}
                          >
                            Early exit
                          </Button>
                        ) : null}
                      </span>
                    ) : null,
                },
              ]}
            />
          )}
        </AsyncBoundary>

        {canRecordMonth && isRecordBlocked ? (
          <p className={PROSE_SM}>
            The recording form above is sending a recording or holding one that was not confirmed. Finish it before recording another month.
          </p>
        ) : null}

        {isPanelHolding ? (
          <p className={PROSE_SM}>
            The schedule panel below is sending a change or holding one that was not confirmed. Finish it before opening another schedule.
          </p>
        ) : null}

        {editing === undefined ? null : (
          <SipScheduleEditor
            key={editing.scheduleId}
            userId={userId}
            schedule={editing}
            onReload={reload}
            onClose={() => {
              setEditingId(null)
            }}
            onHoldChange={setPanelHolding}
          />
        )}

        {exitingId === null || !canWrite ? null : (
          <SipEarlyExitPanel
            key={exitingId}
            userId={userId}
            scheduleId={exitingId}
            onReload={reload}
            onClose={() => {
              setExitingId(null)
            }}
            onHoldChange={setPanelHolding}
          />
        )}
      </Section>
      <SipEarlyExitList userId={userId} investorLabel={investorLabel} canWrite={canWrite} />
    </>
  )
}
