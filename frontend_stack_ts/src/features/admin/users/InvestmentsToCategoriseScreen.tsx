import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useInvestmentsToCategorise } from "~/features/admin/client-values/investmentCleanupQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { clientLedgerPath } from "~/features/admin/client-values/investmentCleanup"
import { useCanOpenClientPage } from "~/features/admin/shared/clientPageLink"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"

const countOf = (count: number, one: string, many: string): string =>
  count === 0 ? "None" : `${String(count)} ${count === 1 ? one : many}`

const LedgerLink = ({ userId, children }: Readonly<{ userId: string; children: string }>): React.ReactElement => {
  const canOpen = useCanOpenClientPage()
  if (!canOpen) return <>{children}</>
  return (
    <Link to={clientLedgerPath(userId)} className={ADMIN_CELL_LINK}>
      {children}
    </Link>
  )
}

const InvestmentsToCategoriseScreen = (): React.ReactElement => {
  const query = useInvestmentsToCategorise(true)

  return (
    <Page width="wide">
      <PageHeader
        title="Investments to categorise"
        description="Clients whose breakdown cannot show yet. Open a client's Ledger tab to give each recording a category, SIP or one-time, and to confirm how earlier growth splits between investments in a fund. The client sees their breakdown as being prepared until then, and gets no email for any of this."
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
            title="Nothing to categorise"
            description="Every client's recordings have a category and every earlier growth split is confirmed."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Clients with investments to categorise"
            rows={data.items}
            rowKey={(row) => row.userId}
            columns={[
              {
                key: "client",
                header: "Client",
                render: (row) => <LedgerLink userId={row.userId}>{row.name}</LedgerLink>,
              },
              {
                key: "recordings",
                header: "Recordings without a category",
                numeric: true,
                render: (row) => countOf(row.waitingRecordings, "recording", "recordings"),
              },
              {
                key: "funds",
                header: "Funds with earlier growth to split",
                numeric: true,
                render: (row) => countOf(row.fundsNeedingSplit, "fund", "funds"),
              },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="clients" />
    </Page>
  )
}

export default InvestmentsToCategoriseScreen
