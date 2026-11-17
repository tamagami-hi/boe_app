import type { SyntheticEvent } from "react"

import { indiaToday } from "~/domain/dates"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

export type StockDraft = Readonly<{
  stockName: string
  quarterLabel: string
  weightPercent: string
  sortOrder: number
}>

const FISCAL_YEAR_START_MONTH = 3
const MONTHS_PER_QUARTER = 3
const MONTHS_PER_YEAR = 12
const QUARTER_PATTERN = /^Q[1-4] FY[0-9]{2}$/u

export const emptyDraft = (): StockDraft => {
  const today = indiaToday()
  const month = Number(today.slice(5, 7)) - 1
  const quarter = Math.floor(((month - FISCAL_YEAR_START_MONTH + MONTHS_PER_YEAR) % MONTHS_PER_YEAR) / MONTHS_PER_QUARTER) + 1
  const year = Number(today.slice(0, 4)) + (month >= FISCAL_YEAR_START_MONTH ? 1 : 0)
  return { stockName: "", quarterLabel: `Q${String(quarter)} FY${String(year).slice(-2)}`, weightPercent: "", sortOrder: 0 }
}

const draftProblems = (draft: StockDraft) => {
  const weight = Number(draft.weightPercent)
  return {
    badName: draft.stockName.trim() === "",
    badQuarter: !QUARTER_PATTERN.test(draft.quarterLabel.trim()),
    badWeight: draft.weightPercent.trim() !== "" && (!Number.isFinite(weight) || weight < 0 || weight > 100),
    badSortOrder: !Number.isInteger(draft.sortOrder) || draft.sortOrder < 0 || draft.sortOrder > 100_000,
  }
}

export const isDraftIncomplete = (draft: StockDraft): boolean => Object.values(draftProblems(draft)).some(Boolean)

export type HoldingFormProps = Readonly<{
  draft: StockDraft
  setDraft: (next: StockDraft) => void
  isEditing: boolean
  isLocked: boolean
  isArchived: boolean
  isPending: boolean
  hasSubmitted: boolean
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void
  onCancel: () => void
}>

export const HoldingForm = ({
  draft,
  setDraft,
  isEditing,
  isLocked,
  isArchived,
  isPending,
  hasSubmitted,
  onSubmit,
  onCancel,
}: HoldingFormProps): React.ReactElement => {
  const { badName, badQuarter, badWeight, badSortOrder } = draftProblems(draft)
  const isDisabled = isLocked || isArchived
  return (
    <Card elevated>
      <form className={STACK_LG} onSubmit={onSubmit} noValidate>
        <div className={ADMIN_FORM_GRID}>
          <FormField label="Stock name" required error={hasSubmitted && badName ? "Enter the stock name." : undefined}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={isDisabled}
                value={draft.stockName}
                maxLength={200}
                onChange={(event) => {
                  setDraft({ ...draft, stockName: event.target.value })
                }}
              />
            )}
          </FormField>

          <FormField
            label="Quarter"
            required
            hint="Reporting quarter, prefilled for the current financial year. You can change it."
            {...(badQuarter && (hasSubmitted || draft.quarterLabel !== "") ? { error: "Enter a reporting quarter like Q1 FY26." } : {})}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={isDisabled}
                value={draft.quarterLabel}
                placeholder="Q1 FY26"
                onChange={(event) => {
                  setDraft({ ...draft, quarterLabel: event.target.value.toUpperCase() })
                }}
              />
            )}
          </FormField>
        </div>

        <div className={ADMIN_FORM_GRID}>
          <FormField
            label="Weight percent"
            hint="Leave empty to disclose the holding without a weight."
            {...(badWeight ? { error: "Enter a percentage between 0 and 100." } : {})}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={isDisabled}
                value={draft.weightPercent}
                onChange={(event) => {
                  setDraft({ ...draft, weightPercent: event.target.value })
                }}
              />
            )}
          </FormField>

          <FormField label="Sort order" hint="Lower numbers appear first." error={badSortOrder ? "Enter a whole number from 0 to 100,000." : undefined}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={isDisabled}
                type="number"
                min={0}
                max={100_000}
                value={String(draft.sortOrder)}
                onChange={(event) => {
                  setDraft({ ...draft, sortOrder: Number(event.target.value) })
                }}
              />
            )}
          </FormField>
        </div>

        <div className={ACTION_ROW}>
          <Button type="submit" disabled={isDisabled} loading={isPending} trailing>
            {isEditing ? "Save the holding" : "Add the holding"}
          </Button>
          {isEditing ? (
            <Button tone="ghost" disabled={isLocked} onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  )
}
