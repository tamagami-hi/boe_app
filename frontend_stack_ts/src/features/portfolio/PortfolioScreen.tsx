import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { toPaise } from "~/domain/money"
import { useFunds, usePortfolio } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import styles from "./Portfolio.module.css"

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
              <span className={styles.label}>Current value</span>
              <MoneyValue amount={toPaise(data.currentValuePaise)} size="xl" />
              <div className={styles.headlineGrid}>
                <div>
                  <span className={styles.label}>Invested</span>
                  <MoneyValue amount={toPaise(data.totalInvestmentPaise)} size="md" />
                </div>
                <div>
                  <span className={styles.label}>Growth</span>
                  <MoneyValue
                    amount={toPaise(data.totalGrowthPaise)}
                    size="md"
                    tone="signed"
                    showSign
                  />
                </div>
                <div>
                  <span className={styles.label}>Return</span>
                  <span className={styles.percent}>{percent(data.returnPercent)}</span>
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
                <Link key={pool.fundId} to={`/funds/${pool.fundId}`} className={styles.poolLink}>
                  <Card>
                    <div className={styles.poolTop}>
                      <span className={styles.poolName}>{nameFor(pool.fundId)}</span>
                      <MoneyValue amount={toPaise(pool.currentValuePaise)} size="md" />
                    </div>
                    <div className={styles.poolMeta}>
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
                      <span className={styles.percentSmall}>{percent(pool.returnPercent)}</span>
                    </div>
                    <span className={styles.poolFooter}>
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
