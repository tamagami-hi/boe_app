import { useState } from "react"
import { useParams } from "react-router-dom"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { toPaise } from "~/domain/money"
import { usePortfolio } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { RadioGroup } from "~/ui/primitives/Toggle"
import { STACK_LG } from "~/ui/recipes/layout"

import { OPTION_TITLES, calendarDate, closedOfferText, isOptionKey, optionDetail, optionsOf } from "./maturityOptionCopy"
import {
  useChooseMaturityOption,
  useMaturityOffer,
  type MaturityOffer,
  type MaturityOptionKey,
} from "./maturityOptionQueries"

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "chosen" }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "rejected"; message: string }>

const UNSENT_MESSAGE = "Your choice could not be sent. Check your connection and try again."

const HoldingFigures = ({ fundId }: Readonly<{ fundId: string }>): React.ReactElement => {
  const portfolio = usePortfolio()
  return (
    <AsyncBoundary query={portfolio} skeleton={<Skeleton height="3rem" />}>
      {(data) => {
        const pool = data.pools.find((entry) => entry.fundId === fundId)
        if (pool === undefined) {
          return <Alert tone="info" title="No current holding">This investment has no value in your portfolio right now.</Alert>
        }
        return (
          <DataList>
            <DetailRow label="Current value" emphasis="lead">
              <MoneyValue amount={toPaise(pool.currentValuePaise)} size="sm" showDecimals />
            </DetailRow>
            <DetailRow label="Amount invested">
              <MoneyValue amount={toPaise(pool.totalInvestmentPaise)} size="sm" showDecimals />
            </DetailRow>
            <DetailRow label="Returns">
              <MoneyValue amount={toPaise(pool.totalGrowthPaise)} size="sm" tone="signed" showSign showDecimals />
            </DetailRow>
          </DataList>
        )
      }}
    </AsyncBoundary>
  )
}

const OptionChooser = ({ offer }: Readonly<{ offer: MaturityOffer }>): React.ReactElement => {
  const choose = useChooseMaturityOption()
  const saved = isOptionKey(offer.chosenOption) ? offer.chosenOption : null
  const [selected, setSelected] = useState<MaturityOptionKey>(saved ?? "return_all")
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" })
  const body = { offerId: offer.offerId, option: selected, expectedVersion: offer.version }
  const idempotencyKey = useIdempotencyKey(body)

  const submit = (): void => {
    setOutcome({ kind: "idle" })
    choose.mutate(
      { ...body, idempotencyKey },
      {
        onSuccess: () => {
          setOutcome({ kind: "chosen" })
        },
        onError: (error) => {
          if (isUnknownWriteOutcome(error)) {
            setOutcome({ kind: "unknown" })
            return
          }
          setOutcome({ kind: "rejected", message: isApiError(error) ? error.message : UNSENT_MESSAGE })
        },
      },
    )
  }

  const locked = choose.isPending || outcome.kind === "unknown"
  return (
    <div className={STACK_LG}>
      {outcome.kind === "chosen" ? (
        <Alert tone="success" title="Choice sent">
          The BeOnEdge team will confirm your choice with you. Nothing changes until they do, and you can change your choice until then.
        </Alert>
      ) : saved === null ? null : (
        <Alert tone="info" title={`You chose: ${OPTION_TITLES[saved]}`}>
          The BeOnEdge team will confirm it with you. You can change your choice until then.
        </Alert>
      )}
      {outcome.kind === "unknown" ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <Button size="sm" loading={choose.isPending} onClick={submit}>
              Check again
            </Button>
          }
        >
          The reply did not arrive, so we do not know whether your choice was saved. Check again sends the same choice once more, and it only ever counts once.
        </Alert>
      ) : null}
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Choice not saved">
          {outcome.message}
        </Alert>
      ) : null}
      <RadioGroup<MaturityOptionKey>
        legend="Your options"
        value={selected}
        options={optionsOf(offer).map((option) => ({ value: option, label: OPTION_TITLES[option], hint: optionDetail(option, offer) }))}
        onChange={(next) => {
          if (!locked) setSelected(next)
        }}
      />
      <Button disabled={locked || selected === saved} loading={choose.isPending} onClick={submit}>
        {saved === null ? "Choose this option" : "Change my choice"}
      </Button>
    </div>
  )
}

const MaturityOptionsScreen = (): React.ReactElement => {
  const { offerId = "" } = useParams()
  const offer = useMaturityOffer(offerId)
  const portfolio = usePortfolio()

  return (
    <Page width="default">
      <PageHeader title="Your maturity options" description="Choose what happens to your investment when it matures." />

      <AsyncBoundary
        query={offer}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
            <Skeleton height="2rem" />
          </Card>
        }
      >
        {(item) => (
          <div className={STACK_LG}>
            <Card elevated>
              <DataList>
                <DetailRow label="Fund">{item.fundName}</DetailRow>
                <DetailRow label="Maturity date">{calendarDate(item.maturityDate)}</DetailRow>
              </DataList>
              <HoldingFigures fundId={item.fundId} />
            </Card>
            {item.state === "open" ? (
              <Card>
                <OptionChooser key={`${item.offerId}-${String(item.version)}`} offer={item} />
              </Card>
            ) : (
              <Alert tone="info" title="Options closed">
                {closedOfferText(item)}
              </Alert>
            )}
          </div>
        )}
      </AsyncBoundary>

      <MoneyFootnote lastUpdated={portfolio.data?.lastUpdated ?? null} />
    </Page>
  )
}

export default MaturityOptionsScreen
