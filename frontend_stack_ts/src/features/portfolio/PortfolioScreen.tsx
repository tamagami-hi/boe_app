import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { toPaise } from "~/domain/money"
import { useFunds, usePortfolio } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { ITEM_TITLE, STAT_LABEL, STAT_ROOT } from "~/ui/recipes/datalist"
import { CARD_LINK } from "~/ui/recipes/surface"
import { META_MUTED, META_TEXT, MONEY_BASE, MONEY_SIZE, MONEY_TONE } from "~/ui/recipes/text"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { HEADLINE_GRID, POOL_META, POOL_TOP } from "./portfolio.recipe"

const percent = (value: number | null): string =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`

const PortfolioScreen = (): React.ReactElement => {
  const query = usePortfolio()
  const funds = useFunds()

  const nameFor = (fundId: string): string =>
    funds.data?.items.find((fund) => fund.id === fundId)?.name ?? "Fund"

  return (
    <Page width="default">
      <PageHeader
        title="Portfolio"
        description="Every figure is derived by the backend from an append-only ledger. Nothing is calculated on this device."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="0.9rem" width="30%" />
            <Skeleton height="2.4rem" width="55%" />
          </Card>
        }
        isEmpty={(data) => data.pools.length === 0}
        empty={
          <EmptyState
            title="You have not invested yet"
            description="Once a payment settles, your holdings and their value appear here."
            action={
              <Link to="/funds">
                <Button>Browse funds</Button>
              </Link>
            }
          />
        }
      >
        {(data) => (
          <>
            <Card elevated>
              <span className={STAT_LABEL}>Current value</span>
              <MoneyValue amount={toPaise(data.currentValuePaise)} size="xl" />
              <div className={HEADLINE_GRID}>
                <div className={STAT_ROOT}>
                  <span className={STAT_LABEL}>Invested</span>
                  <MoneyValue amount={toPaise(data.totalInvestmentPaise)} size="md" />
                </div>
                <div className={STAT_ROOT}>
                  <span className={STAT_LABEL}>Growth</span>
                  <MoneyValue
                    amount={toPaise(data.totalGrowthPaise)}
                    size="md"
                    tone="signed"
                    showSign
                  />
                </div>
                <div className={STAT_ROOT}>
                  <span className={STAT_LABEL}>Return</span>
                  <span className={cx(MONEY_BASE, MONEY_SIZE.md, MONEY_TONE.default)}>
                    {percent(data.returnPercent)}
                  </span>
                </div>
              </div>
            </Card>

            <Section
              title="Positions"
              actions={
                <Link to="/sips">
                  <Button tone="ghost" size="sm">
                    SIP plans
                  </Button>
                </Link>
              }
            >
              {data.pools.map((pool) => (
                <Link key={pool.fundId} to={`/funds/${pool.fundId}`} className={CARD_LINK}>
                  <Card>
                    <div className={POOL_TOP}>
                      <span className={ITEM_TITLE}>{nameFor(pool.fundId)}</span>
                      <MoneyValue amount={toPaise(pool.currentValuePaise)} size="md" />
                    </div>
                    <div className={cx(POOL_META, META_MUTED)}>
                      <span>Invested</span>
                      <MoneyValue amount={toPaise(pool.totalInvestmentPaise)} size="sm" tone="muted" />
                      <span>Growth</span>
                      <MoneyValue
                        amount={toPaise(pool.totalGrowthPaise)}
                        size="sm"
                        tone="signed"
                        showSign
                      />
                      <span>Return</span>
                      <span className={cx(MONEY_BASE, MONEY_SIZE.sm, MONEY_TONE.default)}>
                        {percent(pool.returnPercent)}
                      </span>
                    </div>
                    <span className={META_TEXT}>
                      {pool.sipInstallmentCount === 0
                        ? `${String(pool.lumpSumCount)} lump-sum contribution(s)`
                        : `${String(pool.sipInstallmentCount)} SIP installment(s), ${String(pool.lumpSumCount)} lump sum(s)`}
                    </span>
                  </Card>
                </Link>
              ))}
            </Section>
          </>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default PortfolioScreen
