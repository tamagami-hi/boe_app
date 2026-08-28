import { Link, useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
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

import styles from "./Funds.module.css"

const Row = ({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>): React.ReactElement => (
  <div className={styles.detailRow}>
    <span className={styles.detailLabel}>{label}</span>
    <span className={styles.detailValue}>{children}</span>
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
                <span className={styles.sizeLabel}>Fund size</span>
                <MoneyValue amount={toPaise(fund.fundSize.aumPaise)} size="xl" />
                <span className={styles.category}>
                  {fund.fundSize.asOfDate === null
                    ? "As-of date not published"
                    : `As of ${formatDate(`${fund.fundSize.asOfDate}T00:00:00Z`)}`}
                </span>
              </Card>
            )}

            <Section title="Terms">
              <div className={styles.detail}>
                <Row label="Minimum lump sum">
                  {fund.minimumPurchasePaise === null ? (
                    "Not set"
                  ) : (
                    <MoneyValue amount={toPaise(fund.minimumPurchasePaise)} size="sm" />
                  )}
                </Row>
                <Row label="Minimum SIP">
                  {fund.minimumSipPaise === null ? (
                    "Not set"
                  ) : (
                    <MoneyValue amount={toPaise(fund.minimumSipPaise)} size="sm" />
                  )}
                </Row>
                <Row label="Minimum duration">
                  {fund.minimumDurationMonths === null
                    ? "Not set"
                    : `${String(fund.minimumDurationMonths)} months`}
                </Row>
                <Row label="Recommended holding">
                  {fund.recommendedHoldingMonths === null
                    ? "Not set"
                    : `${String(fund.recommendedHoldingMonths)} months`}
                </Row>
                <Row label="Disclosed holdings">{String(fund.stockCount)}</Row>
                <Row label="Published version">{String(fund.version)}</Row>
              </div>
            </Section>

            {stocks.length === 0 ? null : (
              <Section
                title="Disclosed holdings"
                description={
                  quarter === null
                    ? "Published by the fund administrator."
                    : `Published by the fund administrator for ${quarter}.`
                }
              >
                {weighted.length === 0 ? (
                  <Card>
                    <div className={styles.detail}>
                      {stocks.map((stock) => (
                        <Row key={stock.stockName} label={stock.stockName}>
                          Weight not disclosed
                        </Row>
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
                <p className={styles.disclosureBody}>{disclosure.body}</p>
              </Section>
            )}

            <Section title="Invest">
              {canInvest ? (
                <div className={styles.actions}>
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
                  Investing unlocks once your email is verified. Nothing about this fund is hidden
                  from you in the meantime.
                </Alert>
              )}
            </Section>

            <Section title="Regulatory">
              <div className={styles.actions}>
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
