import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, formatMonth } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { usePortfolio, useStatements } from "~/features/shared/queries"
import { isNative } from "~/platform/capacitor"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { StatementEarlyExits } from "./StatementEarlyExits"
import {
  STATEMENT_BODY,
  STATEMENT_CAPTION,
  STATEMENT_HEAD,
  STATEMENT_HEAD_CELL,
  STATEMENT_HEAD_NUMERIC,
  STATEMENT_MONTH_CELL,
  STATEMENT_NUMERIC_CELL,
  STATEMENT_PREPARED,
  STATEMENT_PRINT_ACTIONS,
  STATEMENT_ROW,
  STATEMENT_TABLE,
  STATEMENT_TABLE_SCROLL,
} from "./statements.recipe"

type StatementPeriod = NonNullable<ReturnType<typeof useStatements>["data"]>["items"][number]

type StatementColumn = Readonly<{ label: string; value: (period: StatementPeriod) => string; signed: boolean }>

const COLUMNS: readonly StatementColumn[] = [
  { label: "Opening", value: (period) => period.openingValuePaise, signed: false },
  { label: "Contributions", value: (period) => period.contributionsPaise, signed: false },
  { label: "Growth", value: (period) => period.growthPaise, signed: true },
  { label: "Corrections", value: (period) => period.reversalsPaise, signed: true },
  { label: "Withdrawals", value: (period) => period.withdrawalsPaise, signed: true },
  { label: "Closing", value: (period) => period.closingValuePaise, signed: false },
  { label: "Invested to date", value: (period) => period.totalInvestmentPaise, signed: false },
]

const printStatement = (): void => {
  window.print()
}

const StatementPrintScreen = (): React.ReactElement => {
  const statements = useStatements()
  const portfolio = usePortfolio()
  const { principal } = useSession()
  const preparedOn = formatDate(new Date().toISOString())
  const holder = principal?.fullName ?? null

  return (
    <Page width="wide">
      <div className={STATEMENT_PRINT_ACTIONS}>
        <ButtonLink to="/statements" tone="ghost" size="sm">
          Back to statements
        </ButtonLink>
        {isNative() ? null : (
          <Button size="sm" onClick={printStatement}>
            Print
          </Button>
        )}
      </div>

      <PageHeader eyebrow="BeOnEdge" title="Investment statement" />
      <p className={STATEMENT_PREPARED}>
        {holder === null ? `Prepared on ${preparedOn}` : `Prepared for ${holder} on ${preparedOn}`}
      </p>

      <AsyncBoundary
        query={statements}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="6rem" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No statements yet"
            description="Your first statement appears once you have invested."
          />
        }
      >
        {(data) => (
          <Card>
            <div className={STATEMENT_TABLE_SCROLL} tabIndex={0} role="region" aria-label="Statement table">
              <table className={STATEMENT_TABLE}>
                <caption className={STATEMENT_CAPTION}>Month-by-month value of your investments</caption>
                <thead className={STATEMENT_HEAD}>
                  <tr>
                    <th scope="col" className={STATEMENT_HEAD_CELL}>
                      Month
                    </th>
                    {COLUMNS.map((column) => (
                      <th key={column.label} scope="col" className={STATEMENT_HEAD_NUMERIC}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={STATEMENT_BODY}>
                  {data.items.map((period) => (
                    <tr key={period.id} className={STATEMENT_ROW}>
                      <th scope="row" className={STATEMENT_MONTH_CELL}>
                        {formatMonth(`${period.period}-01`)}
                      </th>
                      {COLUMNS.map((column) => (
                        <td key={column.label} className={STATEMENT_NUMERIC_CELL} data-label={column.label}>
                          <MoneyValue
                            amount={toPaise(column.value(period))}
                            size="sm"
                            tone={column.signed ? "signed" : "default"}
                            showSign={column.signed}
                            showDecimals
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </AsyncBoundary>

      <StatementEarlyExits />

      <MoneyFootnote lastUpdated={portfolio.data?.lastUpdated ?? null} />
    </Page>
  )
}

export default StatementPrintScreen
