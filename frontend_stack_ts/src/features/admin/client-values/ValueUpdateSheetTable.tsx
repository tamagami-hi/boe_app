import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import type { StatusTone } from "~/domain/status"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Button } from "~/ui/primitives/Button"
import { FormField, Input } from "~/ui/primitives/FormField"
import { FIELD_ERROR, FIELD_HINT } from "~/ui/recipes/field"
import { ACTION_ROW, STACK_SM } from "~/ui/recipes/layout"

import { parseFundRate } from "./valueUpdateSheet"
import type { RowPlan, SheetPlan, SheetRow } from "./valueUpdateSheet"

export type FundRatePrefillProps = Readonly<{
  value: string
  disabled: boolean
  onChange: (value: string) => void
  onFill: (basisPoints: number) => void
}>

export const FundRatePrefill = ({ value, disabled, onChange, onFill }: FundRatePrefillProps): React.ReactElement => {
  const rate = parseFundRate(value)
  return (
    <div className={ACTION_ROW}>
      <FormField
        label="Fund return since invested, in basis points"
        hint="Between -10000 and 10000. Fills every row that has an invested amount with this share of it. 500 fills 5%. Type over any row afterwards."
        {...(rate === null && value !== "" ? { error: "Enter a whole number of basis points between -10000 and 10000." } : {})}
      >
        {({ id }) => (
          <Input
            id={id}
            inputMode="numeric"
            autoComplete="off"
            value={value}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value)
            }}
          />
        )}
      </FormField>
      <Button
        tone="secondary"
        disabled={disabled || rate === null}
        onClick={() => {
          if (rate !== null) onFill(rate)
        }}
      >
        Fill every row
      </Button>
    </div>
  )
}

export type ValueUpdateSheetTableProps = Readonly<{
  rows: readonly SheetRow[]
  inputs: Readonly<Record<string, string>>
  plan: SheetPlan
  locked: boolean
  onInput: (rowKey: string, text: string) => void
}>

const InvestmentCell = ({ row }: Readonly<{ row: SheetRow }>): React.ReactElement => (
  <div className={STACK_SM}>
    <span>{row.label === "" ? "Not categorised yet" : row.label}</span>
    {row.date === null ? null : <span className={FIELD_HINT}>{formatDate(row.date)}</span>}
  </div>
)

const CategoriseFirst = ({ row }: Readonly<{ row: SheetRow }>): React.ReactElement => (
  <div className={STACK_SM}>
    <Badge tone="warning">Categorise first</Badge>
    <ButtonLink to={`/users/${row.userId}?tab=ledger`} size="sm" tone="secondary">
      Open the Ledger tab
    </ButtonLink>
  </div>
)

const ACCOUNT_BADGES: Readonly<Partial<Record<string, Readonly<{ label: string; tone: StatusTone }>>>> = {
  invited: { label: "Invited", tone: "info" },
  suspended: { label: "Suspended", tone: "warning" },
  closed: { label: "Closed", tone: "negative" },
}

const ClientCell = ({ position }: Readonly<{ position: SheetRow }>): React.ReactElement => {
  const badge = ACCOUNT_BADGES[position.accountState]
  return (
    <div className={STACK_SM}>
      <span>{position.fullName}</span>
      {badge === undefined ? null : <Badge tone={badge.tone}>{badge.label}</Badge>}
    </div>
  )
}

type RowOutcomeProps = Readonly<{ id: string; row: RowPlan | undefined }>

const RowOutcome = ({ id, row }: RowOutcomeProps): React.ReactElement | null => {
  if (row === undefined || row.kind === "unchanged" || row.kind === "categorise_first" || row.kind === "no_target") return null
  if (row.kind === "invalid") {
    return (
      <span id={id} className={FIELD_ERROR}>
        {row.message}
      </span>
    )
  }
  return (
    <span id={id} className={FIELD_HINT}>
      Value after <MoneyValue amount={toPaise(row.newValuePaise)} size="sm" showDecimals />
    </span>
  )
}

export const ValueUpdateSheetTable = ({
  rows,
  inputs,
  plan,
  locked,
  onInput,
}: ValueUpdateSheetTableProps): React.ReactElement => (
  <AdminTable
    caption="Investments in this fund, one row per client per investment"
    rows={rows}
    rowKey={(row) => row.rowKey}
    columns={[
      { key: "client", header: "Client", render: (row) => <ClientCell position={row} /> },
      { key: "investment", header: "Investment", render: (row) => <InvestmentCell row={row} /> },
      {
        key: "invested",
        header: "Invested",
        numeric: true,
        render: (row) => <MoneyValue amount={toPaise(row.investedPaise)} size="sm" showDecimals />,
      },
      {
        key: "position",
        header: "Fund value now",
        numeric: true,
        render: (row) => <MoneyValue amount={toPaise(row.positionValuePaise)} size="sm" showDecimals />,
      },
      {
        key: "input",
        header: "Gain since invested (₹)",
        render: (row) => {
          const planned = plan.rows.get(row.rowKey)
          if (planned?.kind === "categorise_first") return <CategoriseFirst row={row} />
          if (planned?.kind === "no_target") {
            return <span className={FIELD_HINT}>No investment to target here yet. A whole fund&apos;s rate reaches it.</span>
          }
          const outcomeId = `value-update-${row.rowKey}`
          return (
            <div className={STACK_SM}>
              <Input
                aria-label={`Gain since invested for ${row.fullName}, ${row.label}, in rupees`}
                aria-describedby={
                  planned === undefined || planned.kind === "unchanged" ? undefined : outcomeId
                }
                inputMode="decimal"
                autoComplete="off"
                placeholder="Unchanged"
                value={inputs[row.rowKey] ?? ""}
                invalid={planned?.kind === "invalid"}
                disabled={locked}
                onChange={(event) => {
                  onInput(row.rowKey, event.target.value)
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
