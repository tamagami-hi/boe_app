import type { AdminClientReturns } from "@beonedge/contracts"
import type { ReactNode } from "react"

import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { Stat } from "~/ui/patterns/DataList"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Card } from "~/ui/primitives/Card"
import { ADMIN_SUMMARY_GRID } from "~/ui/recipes/admin"

import { ReturnValue } from "./ReturnValue"

export const XIRR_ABSENT_HINT = "Shown after 30 days of history, once money in and out gives a defined annual rate."

type Props = Readonly<{
  returns: AdminClientReturns
  asOfDate: string
  lead?: ReactNode
}>

export const ReturnFigures = ({ returns, asOfDate, lead }: Props): React.ReactElement => (
  <Card elevated>
    <div className={ADMIN_SUMMARY_GRID}>
      {lead}
      <Stat label="Invested" hint="Principal recorded, after reversals and withdrawals.">
        <MoneyValue amount={toPaise(returns.investedPaise)} size="md" showDecimals />
      </Stat>
      <Stat label="Current value">
        <MoneyValue amount={toPaise(returns.currentValuePaise)} size="md" showDecimals />
      </Stat>
      <Stat label="Growth">
        <MoneyValue amount={toPaise(returns.growthPaise)} size="md" tone="signed" showSign showDecimals />
      </Stat>
      <Stat label="Simple return" hint="Growth divided by the amount invested.">
        <ReturnValue basisPoints={returns.simpleReturnBasisPoints} size="md" />
      </Stat>
      <Stat
        label="XIRR, annualised"
        hint={
          returns.xirrBasisPoints === null
            ? XIRR_ABSENT_HINT
            : `Money in and out, annualised to ${formatDate(`${asOfDate}T00:00:00Z`)}.`
        }
      >
        <ReturnValue basisPoints={returns.xirrBasisPoints} />
      </Stat>
      <Stat label="Last updated" hint="When the latest ledger entry was recorded.">
        {returns.lastUpdatedAt === null ? "No ledger entry yet" : formatDateTime(returns.lastUpdatedAt)}
      </Stat>
    </div>
    <MoneyFootnote lastUpdated={null} />
  </Card>
)
