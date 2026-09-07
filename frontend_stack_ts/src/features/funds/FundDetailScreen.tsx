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
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { LIST_LABEL, LIST_VALUE } from "~/ui/recipes/datalist"

import { FUND_ACTIONS, FUND_DETAIL_LIST, FUND_DETAIL_ROW, FUND_DISCLOSURE_BODY } from "./funds.recipe"
import { META_MUTED } from "~/ui/recipes/text"

const Row = ({
  label,
  children,
}: Readonly<{ label: string; children?: React.ReactNode }>): React.ReactElement => (
  <div className={FUND_DETAIL_ROW}>
    <span className={LIST_LABEL}>{label}</span>
    {children === undefined ? null : <span className={LIST_VALUE}>{children}</span>}
  </div>
)

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

            {fund.fundSize === null ? null : (
              <Card elevated>
                <span className={META_MUTED}>Fund size</span>
                <MoneyValue amount={toPaise(fund.fundSize.aumPaise)} size="xl" />
                {fund.fundSize.asOfDate === null ? null : (
                  <span className={META_MUTED}>
                    {`As of ${formatDate(`${fund.fundSize.asOfDate}T00:00:00Z`)}`}
                  </span>
                )}
              </Card>
            )}

            <Section title="What you need to know">
              <div className={FUND_DETAIL_LIST}>
                {fund.minimumPurchasePaise === null ? null : (
                  <Row label="Minimum one-off investment">
                    <MoneyValue amount={toPaise(fund.minimumPurchasePaise)} size="sm" />
                  </Row>
                )}
                {fund.minimumSipPaise === null ? null : (
                  <Row label="Minimum monthly SIP">
                    <MoneyValue amount={toPaise(fund.minimumSipPaise)} size="sm" />
                  </Row>
                )}
                {fund.minimumDurationMonths === null ? null : (
                  <Row label="Minimum term">{monthsLabel(fund.minimumDurationMonths)}</Row>
                )}
                {fund.recommendedHoldingMonths === null ? null : (
                  <Row label="Suggested holding period">
                    {monthsLabel(fund.recommendedHoldingMonths)}
                  </Row>
                )}
              </div>
            </Section>

            {stocks.length === 0 ? null : (
              <Section
                title="Holdings"
                {...(quarter === null ? {} : { description: `As disclosed for ${quarter}.` })}
              >
                {weighted.length === 0 ? (
                  <Card>
                    <div className={FUND_DETAIL_LIST}>
                      {stocks.map((stock) => (
                        <Row key={stock.stockName} label={stock.stockName} />
                      ))}
                    </div>
                  </Card>
                ) : (
                  <Card>
                    <DonutChart
                      centreLabel="Holdings"
                      centreValue={String(weighted.length)}
                      slices={weighted.map((stock) => ({
                        key: stock.stockName,
                        label: stock.stockName,
                        value: Number(stock.weightPercent ?? "0"),
                      }))}
                    />
                  </Card>
                )}
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

            <Section title="Invest">
              {canInvest ? (
                <div className={FUND_ACTIONS}>
                  <Link to={`/funds/${fund.id}/invest/lumpsum`}>
                    <Button size="lg" fullWidth>
                      Invest a lump sum
                    </Button>
                  </Link>
                  <Link to={`/funds/${fund.id}/invest/sip`}>
                    <Button size="lg" tone="secondary" fullWidth>
                      Start a SIP
                    </Button>
                  </Link>
                </div>
              ) : (
                <Alert tone="warning" title="Verify your email to invest">
                  You can read everything about this fund now. Verifying your email unlocks
                  investing.
                </Alert>
              )}
            </Section>

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
