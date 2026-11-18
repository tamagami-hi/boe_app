import { isTransportError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate, formatMonth } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { countOf } from "~/domain/plural"
import { usePortfolio, useStatements } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { isNative } from "~/platform/capacitor"
import type { OpenResult } from "~/platform/openExternal"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { STAT_LABEL, STAT_ROOT, SUMMARY_GRID } from "~/ui/recipes/datalist"
import { CARD_COLUMNS, ROW_BETWEEN_BASELINE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { CARD_TITLE, META_TEXT } from "~/ui/recipes/text"

import { useOpenStatement } from "./statementLinkQueries"
import type { StatementRange } from "./statementLinkQueries"

const OPEN_FAILED = "The statement could not be opened. Try again."

const rangeOf = (items: readonly Readonly<{ period: string }>[]): StatementRange | null => {
  const newest = items[0]
  const oldest = items[items.length - 1]
  return newest === undefined || oldest === undefined ? null : { fromPeriod: oldest.period, toPeriod: newest.period }
}

const openProblem = (error: Error | null, result: OpenResult | undefined): string | null => {
  if (error !== null) {
    return isTransportError(error) && (error.kind === "offline" || error.kind === "timeout") ? error.message : OPEN_FAILED
  }
  return result === undefined || result.ok ? null : result.reason
}

const StatementsScreen = (): React.ReactElement => {
  const query = useStatements()
  const portfolio = usePortfolio()
  const openStatement = useOpenStatement()
  const native = isNative()
  const range = rangeOf(query.data?.items ?? [])
  const problem = openProblem(openStatement.error, openStatement.data)

  return (
    <Page width="default">
      <PageHeader
        title="Statements"
        description={
          native
            ? "A month-by-month record of your investments and their value. Open statement shows it in your browser, where you can print or save it."
            : "A month-by-month record of your investments and their value."
        }
        actions={
          native ? (
            range === null ? undefined : (
              <Button
                tone="secondary"
                size="sm"
                loading={openStatement.isPending}
                onClick={() => {
                  openStatement.mutate(range)
                }}
              >
                Open statement
              </Button>
            )
          ) : (
            <ButtonLink to="/statements/print" tone="secondary" size="sm">
              Print statement
            </ButtonLink>
          )
        }
      />

      {problem === null ? null : (
        <Alert tone="error" title="Statement not opened">
          {problem}
        </Alert>
      )}

      <AsyncBoundary
        query={query}
        skeleton={
          <div className={cx(CARD_STACK, CARD_COLUMNS[2])}>
            {[0, 1].map((index) => (
              <Card key={index}>
                <Skeleton height="1.2rem" width="35%" />
                <Skeleton height="2.4rem" />
              </Card>
            ))}
          </div>
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
          <div className={cx(CARD_STACK, CARD_COLUMNS[2])}>
            {data.items.map((period) => (
              <Card key={period.id}>
                <div className={ROW_BETWEEN_BASELINE}>
                  <span className={CARD_TITLE}>{formatMonth(`${period.period}-01`)}</span>
                  <span className={META_TEXT}>
                    {formatDate(period.periodStart)} — {formatDate(period.periodEnd)}
                  </span>
                </div>

                <div className={STAT_ROOT}>
                  <span className={STAT_LABEL}>Closing value</span>
                  <MoneyValue amount={toPaise(period.closingValuePaise)} size="lg" showDecimals />
                </div>

                <div className={SUMMARY_GRID}>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Opening</span>
                    <MoneyValue amount={toPaise(period.openingValuePaise)} size="sm" tone="muted" showDecimals />
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Contributions</span>
                    <MoneyValue amount={toPaise(period.contributionsPaise)} size="sm" showDecimals />
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Growth</span>
                    <MoneyValue amount={toPaise(period.growthPaise)} size="sm" tone="signed" showSign showDecimals />
                  </div>
                  {period.reversalsPaise === "0" ? null : (
                    <div className={STAT_ROOT}>
                      <span className={STAT_LABEL}>Corrections</span>
                      <MoneyValue amount={toPaise(period.reversalsPaise)} size="sm" tone="signed" showSign showDecimals />
                    </div>
                  )}
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Withdrawals</span>
                    <MoneyValue amount={toPaise(period.withdrawalsPaise)} size="sm" tone="signed" showSign showDecimals />
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Invested to date</span>
                    <MoneyValue amount={toPaise(period.totalInvestmentPaise)} size="sm" showDecimals />
                  </div>
                </div>

                <span className={META_TEXT}>
                  {period.entryCount === 1
                    ? "1 entry"
                    : countOf(period.entryCount, "entry", "entries")}
                </span>
              </Card>
            ))}
          </div>
        )}
      </AsyncBoundary>

      <MoneyFootnote lastUpdated={portfolio.data?.lastUpdated ?? null} />
    </Page>
  )
}

export default StatementsScreen
