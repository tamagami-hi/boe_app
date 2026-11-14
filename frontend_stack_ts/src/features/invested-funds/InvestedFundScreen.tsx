import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { usePortfolio } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ACTION_ROW } from "~/ui/recipes/layout"

import { FundReceiptList } from "./FundReceiptList"
import { FundValueUpdateList } from "./FundValueUpdateList"
import { InvestedFundSummary } from "./InvestedFundSummary"
import { useInvestedFund } from "./investedFundQueries"

const CLOSED_FUND =
  "This fund is not open in the fund list right now. Your investment in it, its recorded payments and its value updates are shown here."

const InvestedFundScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams<{ fundId: string }>()
  const fund = useInvestedFund(fundId)
  const portfolio = usePortfolio()

  return (
    <Page width="default">
      <PageHeader
        title={fund.data?.investedFund.fundName ?? "Your investment"}
        description="What this investment is worth, what was recorded and how its value has changed."
      />

      <AsyncBoundary
        query={fund}
        skeleton={
          <Card>
            <Skeleton height="0.9rem" width="30%" />
            <Skeleton height="2.4rem" width="55%" />
          </Card>
        }
      >
        {(data) => (
          <>
            <InvestedFundSummary fundId={fundId} />
            {data.investedFund.fundPublished ? (
              <div className={ACTION_ROW}>
                <ButtonLink to={`/funds/${fundId}`} tone="secondary" size="sm" trailing>
                  Fund details
                </ButtonLink>
              </div>
            ) : (
              <Alert tone="info">{CLOSED_FUND}</Alert>
            )}
            <FundReceiptList fundId={fundId} />
            <FundValueUpdateList fundId={fundId} />
          </>
        )}
      </AsyncBoundary>

      <MoneyFootnote lastUpdated={portfolio.data?.lastUpdated ?? null} />
    </Page>
  )
}

export default InvestedFundScreen
