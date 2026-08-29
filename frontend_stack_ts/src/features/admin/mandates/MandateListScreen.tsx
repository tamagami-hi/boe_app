import { useState } from "react"
import { Link } from "react-router-dom"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDateTime } from "~/domain/dates"
import { mandateState, sipState } from "~/domain/status"
import { useAdminMandates } from "~/features/admin/shared/adminQueries"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CELL_LINK, ADMIN_FIGURE } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

const FILTERS = [
  { value: "attention", label: "Needs attention" },
  { value: "any", label: "All" },
  { value: "setup_pending", label: "Setup pending" },
  { value: "active", label: "Active" },
  { value: "cancel_pending", label: "Cancelling" },
  { value: "cancelled", label: "Cancelled" },
  { value: "failed", label: "Failed" },
] as const

type Filter = (typeof FILTERS)[number]["value"]

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

const MandateListScreen = (): React.ReactElement => {
  const [filter, setFilter] = useState<Filter>("attention")
  const query = useAdminMandates(
    filter === "attention" ? { attention: true } : filter === "any" ? {} : { state: filter },
  )

  const notConfigured =
    query.error !== null && isApiError(query.error) && query.error.code === "RESOURCE_NOT_FOUND"

  return (
    <Page width="wide">
      <PageHeader
        title="Mandates"
        description="PhonePe UPI AutoPay mandates and the collection attempts against them. Nothing here authorises or debits; it reads and reconciles what the provider holds."
      />

      {notConfigured ? (
        <Alert tone="info" title="PhonePe is not configured in this environment">
          The mandate routes are only registered when both PhonePe payment and subscription
          credentials are present. This is not a failure, and it is not a missing screen: there is
          nothing to show until the provider is configured.
        </Alert>
      ) : (
        <>
          <FilterRow label="Mandate state">
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
            notConfigured
            skeleton={
              <Card>
                <Skeleton height="1rem" width="45%" />
                <Skeleton height="1rem" width="70%" />
              </Card>
            }
            isEmpty={(data) => data.items.length === 0}
            empty={
              <EmptyState
                title="No mandate in that state"
                description="Nothing needs a decision here right now."
              />
            }
          >
            {(data) => (
              <AdminTable
                caption="Mandates"
                rows={data.items}
                rowKey={(row) => row.mandateId}
                columns={[
                  {
                    key: "investor",
                    header: "Investor",
                    render: (row) => (
                      <span className={ENTRY_TEXT}>
                        <Link to={`/mandates/${row.mandateId}`} className={ADMIN_CELL_LINK}>
                          {row.userName}
                        </Link>
                        <span className={META_TEXT}>{row.userEmail}</span>
                      </span>
                    ),
                  },
                  { key: "fund", header: "Fund", render: (row) => row.fundName ?? "—" },
                  {
                    key: "amount",
                    header: "Monthly",
                    numeric: true,
                    render: (row) => (
                      <span className={ADMIN_FIGURE}>{rupees.format(row.amountPaise / 100)}</span>
                    ),
                  },
                  {
                    key: "day",
                    header: "Debit day",
                    numeric: true,
                    render: (row) => String(row.debitDay),
                  },
                  {
                    key: "mandate",
                    header: "Mandate",
                    render: (row) => (
                      <StatusBadge status={mandateState(row.mandateState)} />
                    ),
                  },
                  {
                    key: "sip",
                    header: "SIP",
                    render: (row) => <StatusBadge status={sipState(row.sipState)} />,
                  },
                  {
                    key: "attention",
                    header: "Attention",
                    render: (row) => (
                      <span className={META_TEXT}>{row.attentionReason ?? "—"}</span>
                    ),
                  },
                  {
                    key: "updated",
                    header: "Updated",
                    render: (row) => formatDateTime(row.updatedAt),
                  },
                ]}
              />
            )}
          </AsyncBoundary>
        </>
      )}
    </Page>
  )
}

export default MandateListScreen
