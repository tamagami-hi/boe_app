import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { PROSE_SM } from "~/ui/recipes/datalist"

import { GROWTH_REASON_OPTIONS } from "./growthReasons"

type Position = Readonly<{ principalPaise: string; currentValuePaise: string }>

export type GrowthConfirmDialogsProps = Readonly<{
  asking: "append" | "restart" | null
  investorLabel: string
  fundName: string
  effectiveDate: string
  reasonCode: string
  rateLabel: string | null
  position: Position | null
  adjustment: Readonly<{ delta: bigint; projected: bigint }> | null
  onAppend: () => void
  onRestart: () => void
  onCancel: () => void
}>

export const GrowthConfirmDialogs = ({
  asking,
  investorLabel,
  fundName,
  effectiveDate,
  reasonCode,
  rateLabel,
  position,
  adjustment,
  onAppend,
  onRestart,
  onCancel,
}: GrowthConfirmDialogsProps): React.ReactElement => (
  <>
    <ConfirmDialog
      open={asking === "append" && adjustment !== null}
      title="Append this adjustment?"
      confirmLabel="Append the adjustment"
      cancelLabel="Cancel"
      onConfirm={onAppend}
      onCancel={onCancel}
    >
      <DataList>
        <DetailRow label="Investor">{investorLabel}</DetailRow>
        <DetailRow label="Fund">{fundName}</DetailRow>
        {position === null ? null : (
          <DetailRow label="Amount invested">
            <MoneyValue amount={toPaise(position.principalPaise)} size="sm" showDecimals />
          </DetailRow>
        )}
        {position === null ? null : (
          <DetailRow label="Current value">
            <MoneyValue amount={toPaise(position.currentValuePaise)} size="sm" showDecimals />
          </DetailRow>
        )}
        {rateLabel === null ? null : <DetailRow label="Rate">{rateLabel}</DetailRow>}
        {adjustment === null ? null : (
          <DetailRow label="Growth amount" emphasis="lead">
            <MoneyValue amount={toPaise(adjustment.delta.toString())} size="sm" tone="signed" showSign showDecimals />
          </DetailRow>
        )}
        {adjustment === null ? null : (
          <DetailRow label="Projected value">
            <MoneyValue amount={toPaise(adjustment.projected.toString())} size="sm" showDecimals />
          </DetailRow>
        )}
        <DetailRow label="Effective date">{effectiveDate === "" ? "" : formatDate(effectiveDate)}</DetailRow>
        <DetailRow label="Reason">
          {GROWTH_REASON_OPTIONS.find((option) => option.value === reasonCode)?.label ?? reasonCode}
        </DetailRow>
      </DataList>
      <p className={PROSE_SM}>
        One growth entry is appended to this position and the investor is notified. The server recalculates the figures
        and its answer is the truth. A mistake is corrected later with a reversal, not by editing.
      </p>
    </ConfirmDialog>

    <ConfirmDialog
      open={asking === "restart"}
      title="Start a new attempt?"
      description="Check this investor's ledger entries first. If this adjustment is already listed, it was appended, and a new attempt would append it a second time. A new attempt cannot be matched to the unconfirmed one."
      confirmLabel="Start a new attempt"
      confirmTone="danger"
      cancelLabel="Keep this attempt"
      onConfirm={onRestart}
      onCancel={onCancel}
    />
  </>
)
