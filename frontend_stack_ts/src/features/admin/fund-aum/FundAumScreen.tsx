import { useParams } from "react-router-dom"

import type { getAdminFund } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { FundNotFound } from "~/features/admin/funds/FundNotFound"
import { isUnknownRecord } from "~/features/admin/shared/unknownRecord"
import { useAdminAumHistory, useAdminFund } from "~/features/admin/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Card } from "~/ui/primitives/Card"

import { ADMIN_META } from "~/ui/recipes/admin"
import { ITEM_TITLE, LIST_LABEL, LIST_VALUE } from "~/ui/recipes/datalist"
import { CARD_COLUMNS_WRAP, ROW_BETWEEN_BASELINE } from "~/ui/recipes/layout"

import { FundSizeAdjustmentForm, fundSizeSlot } from "./FundSizeAdjustmentForm"
import { OpeningAumForm, openingAumSlot } from "./OpeningAumForm"

type FundAum = NonNullable<DataOf<typeof getAdminFund>["fund"]["aum"]>

const CurrentFundSize = ({ current }: Readonly<{ current: FundAum | null }>): React.ReactElement => (
  <Card elevated>
    <span className={LIST_LABEL}>Current fund size</span>
    {current === null ? (
      <span className={LIST_VALUE}>No opening AUM has been recorded for this fund</span>
    ) : (
      <>
        <MoneyValue amount={toPaise(current.aumPaise)} size="xl" showDecimals />
        <span className={LIST_LABEL}>
          {current.asOfDate === null
            ? "As-of date not recorded"
            : `As of ${formatDate(`${current.asOfDate}T00:00:00Z`)}`}
        </span>
      </>
    )}
  </Card>
)

const FundAumScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const fund = useAdminFund(fundId)
  const history = useAdminAumHistory(fundId)
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["aum.write"])
  const reload = (): void => {
    void fund.refetch()
    history.refetch()
  }

  if (isUnknownRecord(fund.data, fund.error)) {
    return (
      <Page width="wide">
        <PageHeader title="Fund AUM" />
        <FundNotFound />
      </Page>
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={fund.data?.fund.slug ?? ""}
        title="Fund AUM"
        description="Set the fund size or record an increase or decrease. Every change is saved in the history."
      />

      <AsyncBoundary
        query={fund}
        skeleton={
          <Card elevated>
            <Skeleton height="1rem" width="30%" />
            <Skeleton height="2.5rem" width="45%" />
          </Card>
        }
      >
        {(data) => {
          const current = data.fund.aum
          const fundName = data.fund.name ?? data.fund.slug
          return (
            <>
              <CurrentFundSize current={current} />
              {!canWrite ? (
                <Alert tone="info" title="Read only">
                  Recording AUM needs the aum.write permission.
                </Alert>
              ) : (
                <>
                  <OpeningAumForm
                    key={openingAumSlot(fundId)}
                    fundId={fundId}
                    fundName={fundName}
                    hasAum={current !== null}
                    onReload={reload}
                  />
                  {current === null ? null : (
                    <FundSizeAdjustmentForm
                      key={fundSizeSlot(fundId)}
                      fundId={fundId}
                      fundName={fundName}
                      currentAumPaise={current.aumPaise}
                      currentAsOfDate={current.asOfDate}
                      onReload={reload}
                    />
                  )}
                </>
              )}
            </>
          )
        }}
      </AsyncBoundary>

      <Section title="History">
        <AsyncBoundary
          query={history}
          fallback={null}
          skeleton={
            <Card>
              <Skeleton height="1rem" width="40%" />
              <Skeleton height="1rem" width="55%" />
            </Card>
          }
          isEmpty={(data) => data.items.length === 0}
          empty={<EmptyState title="No AUM entries yet" />}
        >
          {(data) => (
            <div className={CARD_COLUMNS_WRAP[3]}>
              {data.items.map((snapshot) => (
                <Card key={snapshot.id}>
                  <div className={ROW_BETWEEN_BASELINE}>
                    <span className={ITEM_TITLE}>
                      {formatDate(`${snapshot.asOfDate}T00:00:00Z`)}
                    </span>
                    <MoneyValue amount={toPaise(snapshot.aumPaise)} size="md" showDecimals />
                  </div>
                  <div className={ADMIN_META}>
                    <span>Revision {String(snapshot.revision)}</span>
                    <span>{snapshot.reasonCode}</span>
                    {snapshot.note === null ? null : <span>{snapshot.note}</span>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </AsyncBoundary>
        <LoadMore list={history} noun="entries" />
      </Section>
    </Page>
  )
}

export default FundAumScreen
