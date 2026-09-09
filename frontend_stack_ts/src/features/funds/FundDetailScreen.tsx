import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { monthsLabel } from "~/domain/plural"
import { toPaise } from "~/domain/money"
import { fundRiskLevel } from "~/domain/status"
import { useEligibility, useFund } from "~/features/shared/queries"
import { FundStockAllocation } from "./FundStockAllocation"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { ITEM_TITLE, STAT_LABEL, STAT_ROOT, SUMMARY_GRID } from "~/ui/recipes/datalist"
import { META_MUTED } from "~/ui/recipes/text"

import { FUND_ACTIONS, FUND_DISCLOSURE_BODY } from "./funds.recipe"

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
                  <ButtonLink to={`/funds/${fund.id}/invest/lumpsum`} size="lg" fullWidth>
                    Invest a lump sum
                  </ButtonLink>
                  <ButtonLink
                    to={`/funds/${fund.id}/invest/sip`}
                    size="lg"
                    tone="secondary"
                    fullWidth
                  >
                    Start a SIP
                  </ButtonLink>
                </div>
              ) : (
                <Alert
                  tone="warning"
                  title="Verify your email to invest"
                  action={
                    <ButtonLink to="/verify-email" tone="secondary" size="sm" trailing>
Verify now
</ButtonLink>
                  }
                >
                  You can read everything about this fund now. Verifying your email unlocks
                  investing.
                </Alert>
              )}
            </Card>

            <Section title="Holdings" description="Stocks held by this fund, grouped by reporting quarter.">
              {stocks.length === 0 ? (
                <p className={META_MUTED}>Holdings have not been disclosed for this fund yet.</p>
              ) : <FundStockAllocation stocks={stocks} />}
            </Section>

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
                <ButtonLink to="/profile/legal/investor-charter" tone="ghost" size="sm">
Investor charter
</ButtonLink>
                <ButtonLink to="/profile/legal/grievance" tone="ghost" size="sm">
Grievance redressal
</ButtonLink>
              </div>
            </Section>
          </Page>
        )
      }}
    </AsyncBoundary>
  )
}

export default FundDetailScreen
