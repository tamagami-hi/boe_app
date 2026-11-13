import { useState } from "react"

import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { useClientSipSchedules } from "~/features/admin/client-values/sipScheduleQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { useAdminInvestorPositions } from "~/features/admin/shared/adminQueries"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { HeldWriteNotice } from "~/features/admin/users/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/users/useHeldWrite"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ENTRY_TEXT, PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { MaturityDateForm, type FundChoice } from "./MaturityDateForm"
import { dueBadgeOf, dueTextOf, formatMaturityDate } from "./maturityPresentation"
import { useCancelMaturity, useClientMaturitySchedules, type MaturityScheduleItem } from "./maturityQueries"
import { MaturityResolveDialog } from "./MaturityResolveDialog"

export type ClientMaturitySectionProps = Readonly<{ userId: string; canSet: boolean }>

type Editing = Readonly<{ schedule: MaturityScheduleItem | null }>

export const ClientMaturitySection = ({ userId, canSet }: ClientMaturitySectionProps): React.ReactElement | null => {
  const { hasAnyPermission } = useSession()
  const canRead = hasAnyPermission(["client_position.write", "client_values.read"])
  const canWrite = hasAnyPermission(["client_position.write"])
  const schedules = useClientMaturitySchedules(canRead ? userId : "")
  const positions = useAdminInvestorPositions(canRead ? userId : "")
  const sips = useClientSipSchedules(canWrite ? userId : "")
  const catalogue = useAdminFundCatalogue()
  const cancel = useHeldWrite(useCancelMaturity(userId), "The cancellation could not be sent. Reload the page and try again.")
  const [editing, setEditing] = useState<Editing | null>(null)
  const [resolving, setResolving] = useState<MaturityScheduleItem | null>(null)
  const [cancelling, setCancelling] = useState<MaturityScheduleItem | null>(null)
  if (!canRead) return null

  const reload = (): void => {
    void schedules.refetch()
    void positions.refetch()
  }
  const items = schedules.data?.items ?? []
  const fundName = (fundId: string): string => {
    const fund = (catalogue.data?.items ?? []).find((entry) => entry.id === fundId)
    return fund?.name ?? fund?.slug ?? items.find((item) => item.fundId === fundId)?.fundName ?? fundId
  }
  const openFunds = new Set(items.filter((item) => item.state === "scheduled").map((item) => item.fundId))
  const funds: readonly FundChoice[] = (positions.data?.items ?? [])
    .filter((row) => !openFunds.has(row.fundId))
    .map((row) => ({ fundId: row.fundId, label: fundName(row.fundId) }))
  const holdingOf = (fundId: string) => positions.data?.items.find((row) => row.fundId === fundId) ?? null
  const activeSipOf = (fundId: string) =>
    sips.data === undefined ? undefined : (sips.data.items.find((row) => row.fundId === fundId && row.state === "active") ?? null)
  const canStart = canWrite && canSet && positions.data !== undefined && schedules.data !== undefined

  return (
    <Section
      title="Maturity dates"
      description="When each holding matures. Nothing happens on the date by itself: from 30 days before it the console reminds you each time it opens, and no money moves until you resolve it here."
      actions={
        canStart && editing === null ? (
          <Button
            size="sm"
            tone="secondary"
            onClick={() => {
              setEditing({ schedule: null })
            }}
          >
            Set a maturity date
          </Button>
        ) : null
      }
    >
      {editing === null ? null : (
        <MaturityDateForm
          key={editing.schedule?.scheduleId ?? "new"}
          userId={userId}
          funds={funds}
          editing={editing.schedule}
          onReload={reload}
          onClose={() => {
            setEditing(null)
          }}
        />
      )}

      <HeldWriteNotice write={cancel} subject="the maturity date was cancelled" onReload={reload} />

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
            <p className={PROSE_SM}>No maturity date is set for this client.</p>
          </Card>
        }
      >
        {(data) => (
          <AdminTable
            caption="Maturity dates"
            rows={data.items}
            rowKey={(row) => row.scheduleId}
            columns={[
              { key: "fund", header: "Fund", render: (row) => row.fundName },
              {
                key: "date",
                header: "Maturity date",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <span>{formatMaturityDate(row.maturityDate)}</span>
                    <span className={META_TEXT}>{dueTextOf(row)}</span>
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (row) => {
                  const badge = dueBadgeOf(row)
                  return <Badge tone={badge.tone}>{badge.label}</Badge>
                },
              },
              {
                key: "manage",
                header: "",
                render: (row) =>
                  canWrite && row.state === "scheduled" ? (
                    <span className={ACTION_ROW}>
                      <Button
                        size="sm"
                        disabled={row.daysUntil > 0 || positions.isPending}
                        onClick={() => {
                          setResolving(row)
                        }}
                      >
                        Resolve
                      </Button>
                      <Button
                        size="sm"
                        tone="ghost"
                        onClick={() => {
                          setEditing({ schedule: row })
                        }}
                      >
                        Change date
                      </Button>
                      <Button
                        size="sm"
                        tone="ghost"
                        disabled={cancel.pending || cancel.outcome.kind === "unknown"}
                        onClick={() => {
                          setCancelling(row)
                        }}
                      >
                        Cancel date
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        )}
      </AsyncBoundary>

      {resolving === null ? null : (
        <MaturityResolveDialog
          key={resolving.scheduleId}
          userId={userId}
          schedule={resolving}
          holding={holdingOf(resolving.fundId)}
          activeSip={activeSipOf(resolving.fundId)}
          refreshing={positions.isFetching || sips.isFetching}
          onReload={reload}
          onClose={() => {
            setResolving(null)
          }}
        />
      )}

      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel this maturity date?"
        description="The date is kept in the history as cancelled. No money moves and the holding is unchanged. You can set a new date afterwards."
        confirmLabel="Cancel the date"
        cancelLabel="Keep the date"
        onConfirm={() => {
          if (cancelling !== null) cancel.submit({ scheduleId: cancelling.scheduleId, expectedVersion: cancelling.version })
          setCancelling(null)
        }}
        onCancel={() => {
          setCancelling(null)
        }}
      />
    </Section>
  )
}
