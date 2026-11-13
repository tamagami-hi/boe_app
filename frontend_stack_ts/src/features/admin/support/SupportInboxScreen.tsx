import { useState } from "react"
import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { supportRequestState, type SupportRequestState } from "~/domain/status"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CELL_LINK, ADMIN_CODE } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

import { SUPPORT_STATE_OPTIONS, categoryText, ticketAge } from "./supportPresentation"
import { useSupportInbox } from "./supportQueries"

type Filter = SupportRequestState | "any"

const FILTERS: readonly Readonly<{ value: Filter; label: string }>[] = [
  ...SUPPORT_STATE_OPTIONS,
  { value: "any", label: "All" },
]

const SupportInboxScreen = (): React.ReactElement => {
  const [filter, setFilter] = useState<Filter>("open")
  const query = useSupportInbox(filter === "any" ? null : filter)
  const now = new Date()

  return (
    <Page width="wide">
      <PageHeader
        title="Support"
        description="Requests clients raise in the app, oldest first. A reply changes the status the client sees and adds a notification in their app."
      />

      <FilterRow label="Request status">
        {FILTERS.map((option) => (
          <FilterChip
            key={option.value}
            active={option.value === filter}
            label={option.label}
            onSelect={() => {
              setFilter(option.value)
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
        empty={
          <EmptyState
            title="No requests here"
            description={filter === "open" ? "Every request has been picked up." : "Choose another status."}
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Support requests"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "client",
                header: "Client",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <Link to={`/support/${row.id}`} className={ADMIN_CELL_LINK}>
                      {row.clientName}
                    </Link>
                    <span className={ADMIN_CODE}>{row.reference}</span>
                  </span>
                ),
              },
              {
                key: "subject",
                header: "Request",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <span>{row.subject}</span>
                    <span className={META_TEXT}>{categoryText(row.category)}</span>
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (row) => <StatusBadge status={supportRequestState(row.status)} />,
              },
              { key: "age", header: "Age", render: (row) => ticketAge(row.createdAt, now) },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="requests" />
    </Page>
  )
}

export default SupportInboxScreen
