import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate, formatDateTime, formatMonth } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { usePortfolio } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { STACK_LG } from "~/ui/recipes/layout"

import { useReceipt } from "./receiptQueries"

const calendarDate = (value: string): string => formatDate(`${value}T00:00:00Z`)

const ReceiptDetailScreen = (): React.ReactElement => {
  const { entryId = "" } = useParams()
  const receipt = useReceipt(entryId)
  const portfolio = usePortfolio()

  return (
    <Page width="default">
      <PageHeader title="Receipt" description="An investment the BeOnEdge team recorded for you." />

      <AsyncBoundary
        query={receipt}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
            <Skeleton height="1rem" width="60%" />
          </Card>
        }
      >
        {({ receipt: item }) => (
          <div className={STACK_LG}>
            {item.reversedAt === null ? null : (
              <Alert tone="warning" title="Reversed">
                {`This recording was reversed on ${formatDate(item.reversedAt)}, so it no longer counts in your portfolio. Contact support if you have questions.`}
              </Alert>
            )}
            <Card elevated>
              <DataList>
                <DetailRow label="Category">{item.categoryLabel}</DetailRow>
                <DetailRow label="Fund">{item.fundName}</DetailRow>
                <DetailRow label="Amount" emphasis="lead">
                  <MoneyValue amount={toPaise(item.amountPaise)} size="sm" showDecimals />
                </DetailRow>
                <DetailRow label="Invested on">{calendarDate(item.effectiveDate)}</DetailRow>
                {item.sipMonth === null ? null : (
                  <DetailRow label="SIP month">{formatMonth(`${item.sipMonth}-01T00:00:00Z`)}</DetailRow>
                )}
                <DetailRow label="Recorded">{formatDateTime(item.recordedAt)}</DetailRow>
              </DataList>
            </Card>
            <ButtonLink to="/activity/receipts" tone="secondary">
              All receipts
            </ButtonLink>
          </div>
        )}
      </AsyncBoundary>

      <MoneyFootnote lastUpdated={portfolio.data?.lastUpdated ?? null} />
    </Page>
  )
}

export default ReceiptDetailScreen
