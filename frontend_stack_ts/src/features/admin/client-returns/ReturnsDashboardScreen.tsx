import { useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { isSessionEnded } from "~/api/errors"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { investorLabel, useInvestorDirectory } from "~/features/admin/client-values/investorQueries"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Stat } from "~/ui/patterns/DataList"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_CELL_LINK, ADMIN_CODE, ADMIN_FIGURE } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

import { ReturnFigures } from "./ReturnFigures"
import { useClientValueSummaries } from "./returnQueries"
import type { ClientValueSummary, ReturnSort } from "./returnQueries"
import { ReturnValue } from "./ReturnValue"

const SORTS: readonly Readonly<{ value: ReturnSort; label: string }>[] = [
  { value: "return_desc", label: "Highest return first" },
  { value: "return_asc", label: "Lowest return first" },
]

const useClientNames = (enabled: boolean) => {
  const directory = useInvestorDirectory(enabled)
  const names = useMemo(
    () => new Map((directory.data?.items ?? []).map((user) => [user.id, investorLabel(user)])),
    [directory.data],
  )
  const error = enabled ? directory.error : null
  return {
    names,
    hasNamesFailed: error !== null && error !== undefined && !isSessionEnded(error),
    retryNames: directory.refetch,
  }
}

const ReturnsDashboardScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canReadUsers = hasAnyPermission(["users.read", "users.read_limited"])
  const [sort, setSort] = useState<ReturnSort>("return_desc")
  const summaries = useClientValueSummaries(sort)
  const { names, hasNamesFailed, retryNames } = useClientNames(canReadUsers)

  const clientCell = (row: ClientValueSummary): React.ReactElement => {
    const name = names.get(row.userId)
    return (
      <span className={ENTRY_TEXT}>
        {canReadUsers ? (
          <Link to={`/users/${row.userId}`} className={ADMIN_CELL_LINK}>
            {name ?? "Open client"}
          </Link>
        ) : null}
        <span className={ADMIN_CODE}>{row.userId}</span>
      </span>
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Returns"
        description="Every client with a recorded investment, folded from the client value ledger on each read. Fund AUM is a separate record and is not reconciled here."
      />

      {hasNamesFailed ? (
        <Alert
          tone="warning"
          title="Client names not loaded"
          action={
            <Button tone="secondary" size="sm" onClick={retryNames}>
              Try again
            </Button>
          }
        >
          The figures are complete. Rows show the client id until the directory loads.
        </Alert>
      ) : null}

      <FilterRow label="Order">
        {SORTS.map((option) => (
          <FilterChip
            key={option.value}
            active={option.value === sort}
            label={option.label}
            onSelect={() => {
              setSort(option.value)
            }}
          />
        ))}
      </FilterRow>

      <AsyncBoundary
        query={summaries}
        skeleton={
          <Card>
            <Skeleton height="1.2rem" width="45%" />
            <Skeleton height="3rem" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No recorded investment yet"
            description="A client appears here once an investment is recorded for them."
          />
        }
      >
        {(data) => (
          <>
            <Section
              title="All clients"
              description={`Totals across every listed client, as of ${formatDate(`${data.asOfDate}T00:00:00Z`)}. Simple return is the headline; XIRR treats all clients as one pool of money in and out.`}
            >
              <ReturnFigures
                returns={data.totals}
                asOfDate={data.asOfDate}
                lead={
                  <Stat label="Clients">
                    <span className={ADMIN_FIGURE}>{String(data.totals.clientCount)}</span>
                  </Stat>
                }
              />
            </Section>

            <Section title="Per client" description="Clients without a simple return are listed last.">
              <AdminTable
                caption="Returns per client"
                rows={data.items}
                rowKey={(row) => row.userId}
                columns={[
                  { key: "client", header: "Client", render: clientCell },
                  {
                    key: "invested",
                    header: "Invested",
                    numeric: true,
                    render: (row) => <MoneyValue amount={toPaise(row.investedPaise)} size="sm" />,
                  },
                  {
                    key: "value",
                    header: "Current value",
                    numeric: true,
                    render: (row) => <MoneyValue amount={toPaise(row.currentValuePaise)} size="sm" />,
                  },
                  {
                    key: "growth",
                    header: "Growth",
                    numeric: true,
                    render: (row) => (
                      <MoneyValue amount={toPaise(row.growthPaise)} size="sm" tone="signed" showSign />
                    ),
                  },
                  {
                    key: "return",
                    header: "Return",
                    numeric: true,
                    render: (row) => <ReturnValue basisPoints={row.simpleReturnBasisPoints} />,
                  },
                  {
                    key: "xirr",
                    header: "XIRR",
                    numeric: true,
                    render: (row) => <ReturnValue basisPoints={row.xirrBasisPoints} />,
                  },
                  {
                    key: "updated",
                    header: "Last updated",
                    render: (row) => (
                      <span className={META_TEXT}>
                        {row.lastUpdatedAt === null ? "No entry" : formatDateTime(row.lastUpdatedAt)}
                      </span>
                    ),
                  },
                ]}
              />
            </Section>
          </>
        )}
      </AsyncBoundary>
      <LoadMore list={summaries} noun="clients" />
    </Page>
  )
}

export default ReturnsDashboardScreen
