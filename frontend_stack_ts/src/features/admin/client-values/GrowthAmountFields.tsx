import { AmountInput } from "~/ui/primitives/AmountInput"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"

export type Direction = "increase" | "decrease"

const DIRECTION_OPTIONS = [
  { value: "increase", label: "Raise the value" },
  { value: "decrease", label: "Lower the value" },
] as const

const MIN_BASIS_POINTS = -2_000
const MAX_BASIS_POINTS = 2_000

export type GrowthAmountFieldsProps = Readonly<{
  mode: "rate" | "amount"
  basisPoints: string
  direction: Direction
  rupees: string
  invalidRate: boolean
  invalidAmount: boolean
  disabled: boolean
  onChange: (patch: Readonly<{ basisPoints?: string; direction?: Direction; rupees?: string }>) => void
}>

export const GrowthAmountFields = ({
  mode,
  basisPoints,
  direction,
  rupees,
  invalidRate,
  invalidAmount,
  disabled,
  onChange,
}: GrowthAmountFieldsProps): React.ReactElement =>
  mode === "rate" ? (
    <FormField
      label="Rate in basis points"
      required
      hint="Between -2000 and 2000, and not zero. 500 is +5% of the amount invested."
      {...(invalidRate && basisPoints !== ""
        ? { error: "Enter a whole non-zero rate between -2000 and 2000 basis points." }
        : {})}
    >
      {({ id }) => (
        <Input
          id={id}
          type="number"
          min={MIN_BASIS_POINTS}
          max={MAX_BASIS_POINTS}
          value={basisPoints}
          disabled={disabled}
          onChange={(event) => {
            onChange({ basisPoints: event.target.value })
          }}
        />
      )}
    </FormField>
  ) : (
    <div className={ADMIN_FORM_GRID}>
      <FormField label="Direction" required>
        {({ id }) => (
          <Select
            id={id}
            options={DIRECTION_OPTIONS.map((option) => ({ ...option }))}
            value={direction}
            disabled={disabled}
            onChange={(event) => {
              onChange({ direction: event.target.value === "decrease" ? "decrease" : "increase" })
            }}
          />
        )}
      </FormField>
      <FormField
        label="Amount in rupees"
        required
        hint="Up to two decimal places, for example 500 or 500.50."
        error={
          invalidAmount && rupees !== ""
            ? "Enter an amount above zero in rupees, with at most two decimal places."
            : undefined
        }
      >
        {({ id, describedBy, invalid }) => (
          <AmountInput
            id={id}
            value={rupees}
            decimals
            invalid={invalid}
            describedBy={describedBy}
            disabled={disabled}
            onChange={(next) => {
              onChange({ rupees: next })
            }}
          />
        )}
      </FormField>
    </div>
  )
