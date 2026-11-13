import { SIP_MONTH_PATTERN } from "~/features/admin/client-values/sipScheduleMonths"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_SM } from "~/ui/recipes/layout"

export type RecordingSheetControlsProps = Readonly<{
  month: string
  fundId: string
  disabled: boolean
  onMonth: (month: string) => void
  onFund: (fundId: string) => void
}>

export const RecordingSheetControls = ({
  month,
  fundId,
  disabled,
  onMonth,
  onFund,
}: RecordingSheetControlsProps): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const fundsFailed = funds.data === undefined && funds.error != null
  const options = [
    { value: "", label: "All funds" },
    ...(funds.data?.items ?? []).map((fund) => ({ value: fund.id, label: fund.name ?? fund.slug })),
  ]

  return (
    <Card elevated>
      <div className={ADMIN_FORM_GRID}>
        <FormField label="Month" required error={SIP_MONTH_PATTERN.test(month) ? undefined : "Choose a month."}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="month"
              value={month}
              invalid={invalid}
              disabled={disabled}
              aria-describedby={describedBy}
              onChange={(event) => {
                onMonth(event.target.value)
              }}
            />
          )}
        </FormField>
        <div className={STACK_SM}>
          <FormField
            label="Fund"
            hint="Optional. All funds lists every schedule due this month."
            error={fundsFailed ? "The fund list could not be loaded, so only All funds can be chosen." : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                options={options}
                value={fundId}
                invalid={invalid}
                disabled={disabled}
                aria-describedby={describedBy}
                onChange={(event) => {
                  onFund(event.target.value)
                }}
              />
            )}
          </FormField>
          {fundsFailed ? (
            <Button size="sm" tone="secondary" onClick={funds.refetch}>
              Load funds again
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
