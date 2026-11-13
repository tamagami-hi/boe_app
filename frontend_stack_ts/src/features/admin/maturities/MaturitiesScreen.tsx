import { useState } from "react"
import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

import { dueBadgeOf, dueTextOf, formatMaturityDate } from "./maturityPresentation"
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

  return (
    <Page width="wide">
      <PageHeader
        title="Maturities"
        description="Maturity dates you set on client holdings, earliest first. Nothing happens on a maturity date by itself: open the client to resolve it, and no money moves until you do."
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
                    <Link to={`/users/${row.userId}`} className={ADMIN_CELL_LINK}>
                      {row.clientName}
                    </Link>
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
                  return <Badge tone={badge.tone}>{badge.label}</Badge>
                },
              },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="maturities" />
    </Page>
  )
}

export default MaturitiesScreen
