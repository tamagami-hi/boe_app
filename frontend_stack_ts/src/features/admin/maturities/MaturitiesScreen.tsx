import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useSession } from "~/app/providers/SessionProvider"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { ClientPageLink } from "~/features/admin/shared/clientPageLink"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

import { MaturityActionButtons, MaturityActionDialog, type MaturityAction } from "./MaturityActions"
import { dueBadgeOf, dueTextOf, formatMaturityDate, offerStatusText } from "./maturityPresentation"
import { useMaturityDashboard, type MaturityDashboardState } from "./maturityQueries"

const FILTERS: readonly Readonly<{ value: MaturityDashboardState; label: string }>[] = [
  { value: "scheduled", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "cancelled", label: "Cancelled" },
]

const EMPTY_TEXT: Readonly<Record<MaturityDashboardState, string>> = {
  scheduled: "No holding has an open maturity date. Set one from a client's page.",
  resolved: "No maturity has been resolved yet.",
  cancelled: "No maturity date has been cancelled.",
}

const MaturitiesScreen = (): React.ReactElement => {
  const [state, setState] = useState<MaturityDashboardState>("scheduled")
  const query = useMaturityDashboard(state)
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_position.write"])
  const [acting, setActing] = useState<MaturityAction | null>(null)

  return (
    <Page width="wide">
      <PageHeader
        title="Maturities"
        description="Maturity dates you set on client holdings, earliest first. Nothing happens on a maturity date by itself: resolve it after talking to the client, or send the options so the client can choose in the app. No money moves until you resolve it or confirm the client's choice."
      />

      <FilterRow label="Maturity status">
        {FILTERS.map((option) => (
          <FilterChip
            key={option.value}
            active={option.value === state}
            label={option.label}
            onSelect={() => {
              setState(option.value)
            }}
          />
        ))}
      </FilterRow>

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title="Nothing here" description={EMPTY_TEXT[state]} />}
      >
        {(data) => (
          <AdminTable
            caption="Maturity dates"
            rows={data.items}
            rowKey={(row) => row.scheduleId}
            columns={[
              {
                key: "client",
                header: "Client",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <ClientPageLink userId={row.userId}>{row.clientName}</ClientPageLink>
                    <span className={META_TEXT}>{row.fundName}</span>
                  </span>
                ),
              },
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
                  const offerText = offerStatusText(row.offer)
                  return (
                    <span className={ENTRY_TEXT}>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {offerText === null ? null : <span className={META_TEXT}>{offerText}</span>}
                    </span>
                  )
                },
              },
              ...(canWrite && state === "scheduled"
                ? [
                    {
                      key: "manage",
                      header: "",
                      render: (row: (typeof data.items)[number]) => <MaturityActionButtons schedule={row} onAct={setActing} />,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="maturities" />
      {acting === null ? null : (
        <MaturityActionDialog
          key={`${acting.schedule.scheduleId}-${acting.kind}`}
          userId={acting.schedule.userId}
          action={acting}
          onClose={() => {
            setActing(null)
          }}
        />
      )}
    </Page>
  )
}

export default MaturitiesScreen
