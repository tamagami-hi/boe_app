import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { fundState } from "~/domain/status"
import { useAdminFunds } from "~/features/admin/shared/queries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"

import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CELL_LINK, ADMIN_CODE } from "~/ui/recipes/admin"
import { ENTRY_TEXT, PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

import { META_TEXT } from "~/ui/recipes/text"

const AumOverviewScreen = (): React.ReactElement => {
  const query = useAdminFunds({})
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["aum.write"])

  return (
    <Page width="wide">
      <PageHeader
        title="AUM"
        description="The absolute size of every fund, and where to move it. Fund size is append-only: a correction is a new entry, never an edit."
        actions={
          canWrite ? (
            <ButtonLink to="/aum/collective" trailing>
Grow several funds
</ButtonLink>
          ) : undefined
        }
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
            title="No funds exist yet"
            description="Create a fund before recording its size."
            action={
              <ButtonLink to="/funds/new" trailing>
Create a fund
</ButtonLink>
            }
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Fund sizes"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "fund",
                header: "Fund",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <Link to={`/funds/${row.id}/aum`} className={ADMIN_CELL_LINK}>
                      {row.name ?? row.slug}
                    </Link>
                    <span className={ADMIN_CODE}>{row.slug}</span>
                  </span>
                ),
              },
              {
                key: "state",
                header: "Lifecycle",
                render: (row) => <StatusBadge status={fundState(row.status)} />,
              },
              {
                key: "aum",
                header: "Fund size",
                numeric: true,
                render: (row) =>
                  row.aum === null ? (
                    <span className={META_TEXT}>Not initialised</span>
                  ) : (
                    <MoneyValue amount={toPaise(row.aum.aumPaise)} size="md" />
                  ),
              },
              {
                key: "asOf",
                header: "As of",
                render: (row) =>
                  row.aum?.asOfDate === undefined || row.aum.asOfDate === null
                    ? "—"
                    : formatDate(`${row.aum.asOfDate}T00:00:00Z`),
              },
              {
                key: "actions",
                header: "Actions",
                render: (row) => (
                  <span className={ACTION_ROW}>
                    <ButtonLink to={`/funds/${row.id}/aum`} tone="secondary" size="sm">
                      {row.aum === null ? "Set opening size" : "Record growth"}
                    </ButtonLink>
                    <ButtonLink to={`/funds/${row.id}/aum/history`} tone="ghost" size="sm">
                      History
                    </ButtonLink>
                  </span>
                ),
              },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="funds" />

      <Section title="Why there is no edit button">
        <Card>
          <p className={PROSE_SM}>
            A fund&apos;s size is derived from an append-only chain of snapshots. Correcting a
            mistake appends a correction that references the snapshot it corrects, so the history
            still shows what was believed and when. Nothing overwrites anything.
          </p>
        </Card>
      </Section>
    </Page>
  )
}

export default AumOverviewScreen
