import { useState } from "react"
import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDateTime } from "~/domain/dates"
import { applicationState } from "~/domain/status"
import { useAdminApplications } from "~/features/admin/shared/adminQueries"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

const FILTERS = [
  { value: "submitted", label: "Waiting" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "any", label: "All" },
] as const

type Filter = (typeof FILTERS)[number]["value"]

const ApplicationQueueScreen = (): React.ReactElement => {
  const [filter, setFilter] = useState<Filter>("submitted")
  const query = useAdminApplications(filter === "any" ? {} : { status: filter })

  return (
    <Page width="wide">
      <PageHeader
        title="Applications"
        description="Everyone waiting for an account. Approving one activates the account and sends the welcome email; rejecting one sends the rejection."
      />

      <FilterRow label="Application status">
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
            title="Nothing waiting here"
            description={
              filter === "submitted"
                ? "Every application has been decided."
                : "No application is in that state."
            }
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Applications"
            rows={data.items}
            rowKey={(row) => row.applicationId}
            columns={[
              {
                key: "applicant",
                header: "Applicant",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <Link
                      to={`/applications/${row.applicationId}`}
                      className={ADMIN_CELL_LINK}
                    >
                      {row.fullName}
                    </Link>
                    <span className={META_TEXT}>{row.email}</span>
                  </span>
                ),
              },
              { key: "phone", header: "Phone", render: (row) => row.phone },
              {
                key: "status",
                header: "Status",
                render: (row) => (
                  <StatusBadge status={applicationState(row.status)} />
                ),
              },
              {
                key: "password",
                header: "Signup password",
                render: (row) =>
                  row.hasSignupPassword ? (
                    <Badge tone="positive">Set</Badge>
                  ) : (
                    <Badge tone="warning">Not set</Badge>
                  ),
              },
              {
                key: "pii",
                header: "PII",
                render: (row) =>
                  row.isPiiTombstoned ? <Badge tone="neutral">Tombstoned</Badge> : "Present",
              },
              {
                key: "createdAt",
                header: "Applied",
                render: (row) => formatDateTime(row.createdAt),
              },
            ]}
          />
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default ApplicationQueueScreen
