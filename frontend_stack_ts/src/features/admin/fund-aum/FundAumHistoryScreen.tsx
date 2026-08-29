import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useAdminAumHistory, useAdminFund } from "~/features/admin/shared/queries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CODE } from "~/ui/recipes/admin"

const FundAumHistoryScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const fund = useAdminFund(fundId)
  const history = useAdminAumHistory(fundId)

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={fund.data?.fund.slug ?? ""}
        title="AUM history"
        description="Every snapshot of this fund's size, newest first, including corrections and the snapshot each one corrects."
      />

      <AsyncBoundary
        query={history}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No snapshots yet"
            description="This fund's size has not been initialised, so there is nothing to show."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="AUM snapshots"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "asOf",
                header: "As of",
                render: (row) => formatDate(`${row.asOfDate}T00:00:00Z`),
              },
              {
                key: "revision",
                header: "Revision",
                numeric: true,
                render: (row) => (
                  <Badge tone={row.revision === 1 ? "neutral" : "warning"}>
                    {String(row.revision)}
                  </Badge>
                ),
              },
              {
                key: "aum",
                header: "Fund size",
                numeric: true,
                render: (row) => <MoneyValue amount={toPaise(row.aumPaise)} size="sm" />,
              },
              {
                key: "batch",
                header: "Growth batch",
                render: (row) => (
                  <span className={ADMIN_CODE}>{row.growthBatchId ?? "direct entry"}</span>
                ),
              },
              { key: "reason", header: "Reason", render: (row) => row.reasonCode },
              {
                key: "recorded",
                header: "Recorded",
                render: (row) => formatDateTime(row.createdAt),
              },
              {
                key: "note",
                header: "Note",
                render: (row) => row.note ?? "—",
              },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={history} noun="entries" />
    </Page>
  )
}

export default FundAumHistoryScreen
