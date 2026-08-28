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
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import styles from "~/features/admin/shared/Admin.module.css"

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
            <Link to="/aum/collective" className={styles.rowLink}>
              <Button trailing>Grow several funds</Button>
            </Link>
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
              <Link to="/funds/new">
                <Button trailing>Create a fund</Button>
              </Link>
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
                  <span className={styles.cellStack}>
                    <Link to={`/funds/${row.id}/aum`} className={styles.cellLink}>
                      {row.name ?? row.slug}
                    </Link>
                    <span className={styles.code}>{row.slug}</span>
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
                    <span className={styles.faint}>Not initialised</span>
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
                  <span className={styles.actions}>
                    <Link to={`/funds/${row.id}/aum`} className={styles.rowLink}>
                      <Button tone="secondary" size="sm">
                        {row.aum === null ? "Set opening size" : "Record growth"}
                      </Button>
                    </Link>
                    <Link to={`/funds/${row.id}/aum/history`} className={styles.rowLink}>
                      <Button tone="ghost" size="sm">
                        History
                      </Button>
                    </Link>
                  </span>
                ),
              },
            ]}
          />
        )}
      </AsyncBoundary>

      <Section title="Why there is no edit button">
        <Card>
          <p className={styles.note}>
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
