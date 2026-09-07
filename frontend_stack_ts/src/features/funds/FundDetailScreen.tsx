import { Link, useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { monthsLabel } from "~/domain/plural"
import { toPaise } from "~/domain/money"
import { fundRiskLevel } from "~/domain/status"
import { useEligibility, useFund } from "~/features/shared/queries"
import { DonutChart } from "~/ui/charts/DonutChart"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { ITEM_TITLE, STAT_LABEL, STAT_ROOT, SUMMARY_GRID } from "~/ui/recipes/datalist"
import { META_MUTED } from "~/ui/recipes/text"

import { FUND_ACTIONS, FUND_ACTION_LINK, FUND_DISCLOSURE_BODY } from "./funds.recipe"

const FundDetailScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const query = useFund(fundId)
  const eligibility = useEligibility()

  const skeleton = (
    <Card>
      <Skeleton height="1.6rem" width="60%" />
      <Skeleton height="1rem" width="35%" />
      <Skeleton height="3rem" width="50%" />
    </Card>
  )

  return (
    <AsyncBoundary query={query} skeleton={<Page width="default">{skeleton}</Page>}>
      {(data) => {
        const { fund, disclosure, stocks } = data
        const canInvest = eligibility.data?.canInvest === true
        const weighted = stocks.filter((stock) => stock.weightPercent !== null)
        const quarter = stocks[0]?.quarterLabel ?? null

        return (
          <Page width="default">
            <PageHeader
              eyebrow={fund.category}
              title={fund.name}
              {...(fund.objective === null ? {} : { description: fund.objective })}
              actions={<StatusBadge status={fundRiskLevel(fund.riskLevel)} />}
            />

            <Card elevated>
              {fund.minimumPurchasePaise === null ? null : (
                <div className={STAT_ROOT}>
                  <span className={STAT_LABEL}>Minimum one-off investment</span>
                  <MoneyValue amount={toPaise(fund.minimumPurchasePaise)} size="lg" />
                </div>
              )}

              <div className={SUMMARY_GRID}>
                {fund.minimumSipPaise === null ? null : (
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Minimum monthly SIP</span>
                    <MoneyValue amount={toPaise(fund.minimumSipPaise)} size="md" />
                  </div>
                )}
                {fund.minimumDurationMonths === null ? null : (
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Minimum term</span>
                    <span className={ITEM_TITLE}>{monthsLabel(fund.minimumDurationMonths)}</span>
                  </div>
                )}
                {fund.recommendedHoldingMonths === null ? null : (
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Suggested holding</span>
                    <span className={ITEM_TITLE}>
                      {monthsLabel(fund.recommendedHoldingMonths)}
                    </span>
                  </div>
                )}
                {fund.fundSize === null ? null : (
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Fund size</span>
                    <MoneyValue amount={toPaise(fund.fundSize.aumPaise)} size="md" tone="muted" />
                    {fund.fundSize.asOfDate === null ? null : (
                      <span className={META_MUTED}>
                        {`As of ${formatDate(`${fund.fundSize.asOfDate}T00:00:00Z`)}`}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {canInvest ? (
                <div className={FUND_ACTIONS}>
                  <Link to={`/funds/${fund.id}/invest/lumpsum`} className={FUND_ACTION_LINK}>
                    <Button size="lg" fullWidth>
                      Invest a lump sum
                    </Button>
                  </Link>
                  <Link to={`/funds/${fund.id}/invest/sip`} className={FUND_ACTION_LINK}>
                    <Button size="lg" tone="secondary" fullWidth>
                      Start a SIP
                    </Button>
                  </Link>
                </div>
              ) : (
                <Alert
                  tone="warning"
                  title="Verify your email to invest"
                  action={
                    <Link to="/verify-email">
                      <Button size="sm" tone="secondary" trailing>
                        Verify now
                      </Button>
                    </Link>
                  }
                >
                  You can read everything about this fund now. Verifying your email unlocks
                  investing.
                </Alert>
              )}
            </Card>

            {stocks.length === 0 ? null : (
              <Section
                title="Holdings"
                {...(quarter === null ? {} : { description: `As disclosed for ${quarter}.` })}
              >
                <Card>
                  {weighted.length === 0 ? (
                    <DataList>
                      {stocks.map((stock) => (
                        <DetailRow key={stock.stockName} label={stock.stockName}>
                          {null}
                        </DetailRow>
                      ))}
                    </DataList>
                  ) : (
                    <DonutChart
                      centreLabel="Holdings"
                      centreValue={String(weighted.length)}
                      slices={weighted.map((stock) => ({
                        key: stock.stockName,
                        label: stock.stockName,
                        value: Number(stock.weightPercent ?? "0"),
                      }))}
                    />
                  )}
                </Card>
              </Section>
            )}

            {disclosure === null ? null : (
              <Section
                title={disclosure.title}
                description={`Effective from ${formatDate(disclosure.effectiveFrom)}`}
              >
                <p className={FUND_DISCLOSURE_BODY}>{disclosure.body}</p>
              </Section>
            )}

            <Section title="Investor information">
              <div className={FUND_ACTIONS}>
                <Link to="/profile/legal/investor-charter">
                  <Button tone="ghost" size="sm">
                    Investor charter
                  </Button>
                </Link>
                <Link to="/profile/legal/grievance">
                  <Button tone="ghost" size="sm">
                    Grievance redressal
                  </Button>
                </Link>
              </div>
            </Section>
          </Page>
        )
      }}
    </AsyncBoundary>
  )
}

export default FundDetailScreen
