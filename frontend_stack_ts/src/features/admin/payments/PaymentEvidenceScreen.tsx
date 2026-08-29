import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { paymentState } from "~/domain/status"
import { useAdminPayments } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CODE } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"

const PaymentEvidenceScreen = (): React.ReactElement => {
  const query = useAdminPayments()

  return (
    <Page width="wide">
      <PageHeader
        title="Payments"
        description="Every payment and the raw provider state behind it. This is the evidence trail, not a place to change anything."
      />

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
            title="No payments recorded"
            description="A payment appears here the moment an investor starts a checkout."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Payments"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "user",
                header: "Investor",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <span>{row.userEmail}</span>
                    <span className={ADMIN_CODE}>{row.orderId}</span>
                  </span>
                ),
              },
              {
                key: "amount",
                header: "Amount",
                numeric: true,
                render: (row) => <MoneyValue amount={toPaise(row.amountPaise)} size="sm" />,
              },
              {
                key: "state",
                header: "Raw state",
                render: (row) => (
                  <StatusBadge status={paymentState(row.status)} />
                ),
              },
              { key: "provider", header: "Provider", render: (row) => row.provider ?? "—" },
              {
                key: "reference",
                header: "Provider reference",
                render: (row) => (
                  <span className={ADMIN_CODE}>{row.providerReference ?? "—"}</span>
                ),
              },
              {
                key: "attempts",
                header: "Attempts",
                numeric: true,
                render: (row) => String(row.attemptCount),
              },
              {
                key: "succeeded",
                header: "Succeeded",
                render: (row) =>
                  row.succeededAt === null ? "—" : formatDateTime(row.succeededAt),
              },
              {
                key: "failed",
                header: "Failed",
                render: (row) => (row.failedAt === null ? "—" : formatDateTime(row.failedAt)),
              },
            ]}
          />
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default PaymentEvidenceScreen
