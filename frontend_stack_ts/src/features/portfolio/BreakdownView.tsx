import { Link } from "react-router-dom"

import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { formatBasisPoints } from "~/domain/percent"
import { investedFundPath } from "~/features/invested-funds/investedFundPath"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { CARD_COLUMNS_WRAP } from "~/ui/recipes/layout"
import { BODY_SM, LINK_TEXT, META_MUTED, META_TEXT, MONEY_BASE, MONEY_SIZE, MONEY_TONE } from "~/ui/recipes/text"

import { useInvestmentBreakdown } from "./breakdownQueries"
import type { BreakdownLine, FundBreakdown, OneTimeBreakdown, SipBreakdown } from "./breakdownQueries"
import {
  BREAKDOWN_BLOCK,
  BREAKDOWN_BLOCK_TITLE,
  BREAKDOWN_FUND,
  BREAKDOWN_FUND_TITLE,
  BREAKDOWN_META,
} from "./portfolio.recipe"

const PREPARING = "Your breakdown is being prepared by BeOnEdge."

const XIRR_PENDING = "Available after 30 days"

type ReturnTextProps = Readonly<{ basisPoints: string | null; isNeutral?: boolean }>

const ReturnText = ({ basisPoints, isNeutral = false }: ReturnTextProps): React.ReactElement => (
  <span className={cx(MONEY_BASE, MONEY_SIZE.sm, isNeutral ? MONEY_TONE.muted : MONEY_TONE.default)}>
    {formatBasisPoints(basisPoints, { showSign: !isNeutral })}
  </span>
)

type Figures = Readonly<{
  investedPaise: string
  valuePaise: string
  growthPaise: string
  simpleReturnBasisPoints: string | null
}>

const FigureRows = ({ figures, isNeutral = false }: Readonly<{ figures: Figures; isNeutral?: boolean }>): React.ReactElement => (
  <>
    <dt>Invested</dt>
    <dd>
      <MoneyValue amount={toPaise(figures.investedPaise)} size="sm" showDecimals tone="muted" />
    </dd>
    <dt>Current value</dt>
    <dd>
      <MoneyValue amount={toPaise(figures.valuePaise)} size="sm" showDecimals />
    </dd>
    <dt>Growth</dt>
    <dd>
      {isNeutral ? (
        <MoneyValue amount={toPaise(figures.growthPaise)} size="sm" showDecimals tone="muted" />
      ) : (
        <MoneyValue amount={toPaise(figures.growthPaise)} size="sm" showDecimals tone="signed" showSign />
      )}
    </dd>
    <dt>Return</dt>
    <dd>
      <ReturnText basisPoints={figures.simpleReturnBasisPoints} isNeutral={isNeutral} />
    </dd>
  </>
)

const SipBlock = ({ sip }: Readonly<{ sip: SipBreakdown }>): React.ReactElement => (
  <div className={BREAKDOWN_BLOCK}>
    <h4 className={BREAKDOWN_BLOCK_TITLE}>{sip.state === "active" ? "SIP" : "Ended SIP"}</h4>
    <dl className={cx(BREAKDOWN_META, META_MUTED)}>
      <FigureRows figures={sip} />
      <dt>Annualised return (XIRR)</dt>
      <dd>{sip.xirrBasisPoints === null ? XIRR_PENDING : <ReturnText basisPoints={sip.xirrBasisPoints} />}</dd>
    </dl>
    <span className={META_TEXT}>{`${String(sip.monthsPaid)} of ${String(sip.monthsTotal)} months paid`}</span>
  </div>
)

const OneTimeBlock = ({ investment }: Readonly<{ investment: OneTimeBreakdown }>): React.ReactElement => (
  <div className={BREAKDOWN_BLOCK}>
    <h4 className={BREAKDOWN_BLOCK_TITLE}>
      One-time investment
      {investment.reversed ? <Badge tone="neutral">Reversed</Badge> : null}
    </h4>
    <dl className={cx(BREAKDOWN_META, META_MUTED)}>
      <dt>Date</dt>
      <dd>{formatDate(`${investment.effectiveDate}T00:00:00Z`)}</dd>
      <FigureRows figures={investment} isNeutral={investment.reversed} />
    </dl>
  </div>
)

const LineBlock = ({ line }: Readonly<{ line: BreakdownLine }>): React.ReactElement => (
  <div className={BREAKDOWN_BLOCK}>
    <dl className={cx(BREAKDOWN_META, META_MUTED)}>
      <dt className={BREAKDOWN_BLOCK_TITLE}>Other adjustments</dt>
      <dd>
        <MoneyValue amount={toPaise(line.valuePaise)} size="sm" showDecimals tone="signed" showSign />
      </dd>
    </dl>
  </div>
)

const activeFirst = (sips: readonly SipBreakdown[]): SipBreakdown[] =>
  [...sips].sort((left, right) => Number(left.state !== "active") - Number(right.state !== "active"))

const newestFirst = (investments: readonly OneTimeBreakdown[]): OneTimeBreakdown[] =>
  [...investments].sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))

const FundCard = ({ fund }: Readonly<{ fund: FundBreakdown }>): React.ReactElement => (
  <Card>
    <div className={BREAKDOWN_FUND}>
      <h3 className={BREAKDOWN_FUND_TITLE}>
        <Link to={investedFundPath(fund.fundId)} className={LINK_TEXT}>
          {fund.fundName}
        </Link>
      </h3>
      {fund.status === "preparing" ? (
        <p className={cx(BODY_SM, "m-0")}>{PREPARING}</p>
      ) : (
        <>
          {activeFirst(fund.sips).map((sip) => (
            <SipBlock key={sip.scheduleId} sip={sip} />
          ))}
          {newestFirst(fund.oneTime).map((investment, index) => (
            <OneTimeBlock key={`${investment.effectiveDate}:${String(index)}`} investment={investment} />
          ))}
          {fund.lines.map((line) => (
            <LineBlock key={line.kind} line={line} />
          ))}
        </>
      )}
    </div>
  </Card>
)

export const BreakdownView = (): React.ReactElement => {
  const query = useInvestmentBreakdown()
  return (
    <AsyncBoundary
      query={query}
      skeleton={
        <Card>
          <Skeleton height="1rem" width="45%" />
          <Skeleton height="0.9rem" width="70%" />
          <Skeleton height="0.9rem" width="60%" />
        </Card>
      }
      isEmpty={(data) => data.funds.length === 0}
      empty={
        <EmptyState
          title="Nothing to break down yet"
          description="Each fund you hold appears here with its SIP and one-time investments."
        />
      }
    >
      {(data) => (
        <div className={CARD_COLUMNS_WRAP[2]}>
          {data.funds.map((fund) => (
            <FundCard key={fund.fundId} fund={fund} />
          ))}
        </div>
      )}
    </AsyncBoundary>
  )
}
