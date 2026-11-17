import type { AdminInvestorPositionsData } from "@beonedge/contracts"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { PROSE_SM } from "~/ui/recipes/datalist"

export type MaturityAsk = "mark" | "withdrawal" | "reinvestment"

type Position = AdminInvestorPositionsData["items"][number]

const COPY: Readonly<Record<MaturityAsk, Readonly<{ title: string; confirm: string; body: string }>>> = {
  mark: {
    title: "Mark this position matured?",
    confirm: "Mark matured",
    body: "The position is recorded as matured on this date. It is then settled by a withdrawal or a reinvestment.",
  },
  withdrawal: {
    title: "Record this withdrawal?",
    confirm: "Record the withdrawal",
    body: "This reduces the investor's current value and creates a pending payout. The maturity is settled, including for a partial withdrawal. No bank transfer is made by this.",
  },
  reinvestment: {
    title: "Reinvest this position?",
    confirm: "Reinvest the position",
    body: "The entire current value becomes the new invested amount. Any accumulated profit or loss is included, and the maturity is settled.",
  },
}

export type MaturityPanelConfirmProps = Readonly<{
  asking: MaturityAsk | null
  investorLabel: string
  fundName: string
  date: string
  position: Position | undefined
  withdrawalPaise: string | null
  onConfirm: () => void
  onCancel: () => void
}>

export const MaturityPanelConfirm = ({
  asking,
  investorLabel,
  fundName,
  date,
  position,
  withdrawalPaise,
  onConfirm,
  onCancel,
}: MaturityPanelConfirmProps): React.ReactElement => {
  const copy = COPY[asking ?? "mark"]
  return (
    <ConfirmDialog
      open={asking !== null}
      title={copy.title}
      confirmLabel={copy.confirm}
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <DataList>
        <DetailRow label="Investor">{investorLabel}</DetailRow>
        <DetailRow label="Fund">{fundName}</DetailRow>
        <DetailRow label={asking === "mark" ? "Maturity date" : "Settlement date"}>
          {date === "" ? "" : formatDate(date)}
        </DetailRow>
        {position === undefined ? null : (
          <DetailRow label="Amount invested">
            <MoneyValue amount={toPaise(position.principalPaise)} size="sm" showDecimals />
          </DetailRow>
        )}
        {position === undefined ? null : (
          <DetailRow label="Current value" emphasis={asking === "withdrawal" ? "default" : "lead"}>
            <MoneyValue amount={toPaise(position.currentValuePaise)} size="sm" showDecimals />
          </DetailRow>
        )}
        {asking === "withdrawal" && withdrawalPaise !== null ? (
          <DetailRow label="Withdrawal" emphasis="lead">
            <MoneyValue amount={toPaise(withdrawalPaise)} size="sm" showDecimals />
          </DetailRow>
        ) : null}
      </DataList>
      <p className={PROSE_SM}>{copy.body}</p>
    </ConfirmDialog>
  )
}
