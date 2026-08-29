import { useState } from "react"
import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { fundReceiptAcknowledgementState, paymentState } from "~/domain/status"
import { useAdminReceipts } from "~/features/admin/shared/adminQueries"
import type { ReceiptFilter } from "~/features/admin/shared/adminQueries"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

const FILTERS = [
  { value: "pending", label: "To acknowledge" },
  { value: "acknowledged", label: "Acknowledged" },
] as const

const FundReceiptQueueScreen = (): React.ReactElement => {
  const [filter, setFilter] = useState<ReceiptFilter>("pending")
  const query = useAdminReceipts(filter)

  return (
    <Page width="wide">
      <PageHeader
        title="Fund receipts"
        description="A payment PhonePe has settled is not investable until you acknowledge that the funds arrived. Acknowledging notifies the investor."
      />

      <FilterRow label="Receipt state">
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
            title={filter === "pending" ? "Nothing to acknowledge" : "Nothing acknowledged yet"}
            description={
              filter === "pending"
                ? "Every settled payment has been acknowledged."
                : "Acknowledged receipts appear here once you confirm the funds arrived."
            }
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Fund receipts"
            rows={data.items}
            rowKey={(row) => row.orderId}
            columns={[
              {
                key: "client",
                header: "Investor",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <Link to={`/receipts/${row.orderId}`} className={ADMIN_CELL_LINK}>
                      {row.client.name}
                    </Link>
                    <span className={META_TEXT}>{row.client.email}</span>
                  </span>
                ),
              },
              {
                key: "fund",
                header: "Fund",
                render: (row) => row.selectedFund.name,
              },
              {
                key: "amount",
                header: "Amount",
                numeric: true,
                render: (row) => <MoneyValue amount={toPaise(row.amountPaise)} size="sm" />,
              },
              {
                key: "payment",
                header: "Payment",
                render: (row) => (
                  <StatusBadge status={paymentState(row.payment.state)} />
                ),
              },
              {
                key: "receipt",
                header: "Receipt",
                render: (row) => (
                  <StatusBadge
                    status={fundReceiptAcknowledgementState(row.acknowledgement.state)}
                  />
                ),
              },
              {
                key: "settled",
                header: "Settled",
                render: (row) =>
                  row.payment.succeededAt === null
                    ? "—"
                    : formatDateTime(row.payment.succeededAt),
              },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="receipts" />
    </Page>
  )
}

export default FundReceiptQueueScreen
