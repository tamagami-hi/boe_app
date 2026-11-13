import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { Button } from "~/ui/primitives/Button"
import { FormField } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { STACK_SM } from "~/ui/recipes/layout"

export type CatalogueFundPickerProps = Readonly<{
  value: string
  disabled: boolean
  onChange: (fundId: string) => void
}>

export const CatalogueFundPicker = ({
  value,
  disabled,
  onChange,
}: CatalogueFundPickerProps): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const failed = funds.data === undefined && funds.error != null
  const catalogue = funds.data?.items ?? []
  const prompt = failed
    ? "Funds could not be loaded"
    : funds.data === undefined
      ? "Loading funds"
      : catalogue.length === 0
        ? "No fund exists yet"
        : "Choose a fund"
  const options = [
    { value: "", label: prompt },
    ...catalogue.map((fund) => ({ value: fund.id, label: fund.name ?? fund.slug })),
  ]

  return (
    <div className={STACK_SM}>
      <FormField
        label="Fund"
        required
        error={failed ? "The fund list could not be loaded, so no fund can be chosen." : undefined}
      >
        {({ id, invalid }) => (
          <Select
            id={id}
            options={options}
            value={value}
            invalid={invalid}
            disabled={disabled || catalogue.length === 0}
            onChange={(event) => {
              onChange(event.target.value)
            }}
          />
        )}
      </FormField>
      {failed ? (
        <Button size="sm" tone="secondary" onClick={funds.refetch}>
          Load funds again
        </Button>
      ) : null}
    </div>
  )
}
