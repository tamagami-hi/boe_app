import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { formatINR, toPaise } from "~/domain/money"
import { countOf } from "~/domain/plural"
import { formatPercent } from "~/domain/percent"
import { INVESTMENTS_RECORDED_NOTE } from "~/features/investing/InvestmentsRecorded"
import { useOnlinePaymentsOff } from "~/features/investing/onlinePayments"
import { FundName, FundNamesFailure, useFundNames } from "~/features/invested-funds/FundNames"
import { investedFundPath } from "~/features/invested-funds/investedFundPath"
import { MaturityOffersCard } from "~/features/maturity-options/MaturityOffersCard"
import { usePortfolio, useSipPlans } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { ITEM_TITLE, STAT_LABEL, STAT_ROOT, SUMMARY_GRID } from "~/ui/recipes/datalist"
import { ACTION_ROW, CARD_COLUMNS_WRAP } from "~/ui/recipes/layout"
import { CARD_LINK } from "~/ui/recipes/surface"
import { META_MUTED, META_TEXT, MONEY_BASE, MONEY_SIZE, MONEY_TONE } from "~/ui/recipes/text"

import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { POOL_META, POOL_TOP } from "./portfolio.recipe"
import { SipSchedulesSection } from "./SipSchedulesSection"

const PortfolioScreen = (): React.ReactElement => {
  const query = usePortfolio()
  const names = useFundNames()
  const sips = useSipPlans()
  const paymentsOff = useOnlinePaymentsOff()
  const showsSipPlans = (sips.data === undefined && sips.isError) || (sips.data?.items.length ?? 0) > 0

  return (
    <Page width="default">
      <PageHeader
        title="Portfolio"
        description="What you own today, and how it has grown."
      />

      <MaturityOffersCard />

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
            description={
              paymentsOff
                ? INVESTMENTS_RECORDED_NOTE
                : "Your holdings will appear here once your first investment is complete."
            }
            action={
              paymentsOff ? null : (
                <ButtonLink to="/funds">
                  Browse funds
                </ButtonLink>
              )
            }
          />
        }
      >
        {(data) => (
          <>
            <Card elevated>
              <span className={STAT_LABEL}>Current value</span>
              <MoneyValue amount={toPaise(data.currentValuePaise)} size="xl" />
              <div className={SUMMARY_GRID}>
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
                    {formatPercent(data.returnPercent, { showSign: true })}
                  </span>
                </div>
              </div>
            </Card>

            <Section
              title="Positions"
              actions={
                <span className={ACTION_ROW}>
                  <ButtonLink to="/portfolio/value-updates" tone="secondary" size="sm">
                    Value updates
                  </ButtonLink>
                  {showsSipPlans ? (
                    <ButtonLink to="/sips" tone="secondary" size="sm">
                      SIP plans
                    </ButtonLink>
                  ) : null}
                </span>
              }
            >
              <FundNamesFailure names={names} />
              <div className={CARD_COLUMNS_WRAP[3]}>
                {data.pools.map((pool) => (
                <Link key={pool.fundId} to={investedFundPath(pool.fundId)} className={CARD_LINK}>
                  <Card>
                    <div className={POOL_TOP}>
                      <span className={ITEM_TITLE}>
                        <FundName names={names} fundId={pool.fundId} />
                      </span>
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
                        {formatPercent(pool.returnPercent, { showSign: true })}
                      </span>
                    </div>
                    <span className={META_TEXT}>
                      {pool.withdrawnTotalPaise === "0"
                        ? countOf(pool.contributionCount, "payment")
                        : `${countOf(pool.contributionCount, "payment")} · ${formatINR(toPaise(pool.withdrawnTotalPaise))} withdrawn`}
                    </span>
                  </Card>
                  </Link>
                ))}
              </div>
            </Section>

            <MoneyFootnote lastUpdated={data.lastUpdated} />
          </>
        )}
      </AsyncBoundary>

      <SipSchedulesSection />
    </Page>
  )
}

export default PortfolioScreen
