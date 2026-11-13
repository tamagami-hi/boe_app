import { toPaise } from "~/domain/money"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Input } from "~/ui/primitives/FormField"
import { FIELD_ERROR, FIELD_HINT } from "~/ui/recipes/field"
import { STACK_SM } from "~/ui/recipes/layout"

import type { RowPlan, SheetPlan, SheetPosition } from "./valueUpdateSheet"

export type ValueUpdateSheetTableProps = Readonly<{
  positions: readonly SheetPosition[]
  inputs: Readonly<Record<string, string>>
  plan: SheetPlan
  locked: boolean
  onInput: (userId: string, text: string) => void
}>

type RowOutcomeProps = Readonly<{ id: string; row: RowPlan | undefined }>

const RowOutcome = ({ id, row }: RowOutcomeProps): React.ReactElement | null => {
  if (row === undefined || row.kind === "unchanged") return null
  if (row.kind === "invalid") {
    return (
      <span id={id} className={FIELD_ERROR}>
        {row.message}
      </span>
    )
  }
  return (
    <span id={id} className={FIELD_HINT}>
      Change <MoneyValue amount={toPaise(row.changePaise)} size="sm" tone="signed" showSign showDecimals />
    </span>
  )
}

export const ValueUpdateSheetTable = ({
  positions,
  inputs,
  plan,
  locked,
  onInput,
}: ValueUpdateSheetTableProps): React.ReactElement => (
  <AdminTable
    caption="Client positions in this fund"
    rows={positions}
    rowKey={(row) => row.userId}
    columns={[
      { key: "client", header: "Client", render: (row) => row.fullName },
      {
        key: "invested",
        header: "Invested",
        numeric: true,
        render: (row) => <MoneyValue amount={toPaise(row.investedPaise)} size="sm" showDecimals />,
      },
      {
        key: "value",
        header: "Current value",
        numeric: true,
        render: (row) => <MoneyValue amount={toPaise(row.currentValuePaise)} size="sm" showDecimals />,
      },
      {
        key: "gain",
        header: "Gain so far",
        numeric: true,
        render: (row) => (
          <MoneyValue amount={toPaise(row.gainPaise)} size="sm" tone="signed" showSign showDecimals />
        ),
      },
      {
        key: "input",
        header: "Gain since investment (₹)",
        render: (row) => {
          const outcomeId = `value-update-${row.userId}`
          const planned = plan.rows.get(row.userId)
          return (
            <div className={STACK_SM}>
              <Input
                aria-label={`Gain since investment for ${row.fullName}, in rupees`}
                aria-describedby={
                  planned === undefined || planned.kind === "unchanged" ? undefined : outcomeId
                }
                inputMode="decimal"
                autoComplete="off"
                placeholder="Unchanged"
                value={inputs[row.userId] ?? ""}
                invalid={planned?.kind === "invalid"}
                disabled={locked}
                onChange={(event) => {
                  onInput(row.userId, event.target.value)
                }}
              />
              <RowOutcome id={outcomeId} row={planned} />
            </div>
          )
        },
      },
    ]}
  />
)
