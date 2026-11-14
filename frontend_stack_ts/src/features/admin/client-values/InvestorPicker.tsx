import { useMemo, useState } from "react"

import { useAdminUsers } from "~/features/admin/users/userDirectoryQueries"
import { Button } from "~/ui/primitives/Button"
import { Combobox } from "~/ui/primitives/Combobox"
import { FormField } from "~/ui/primitives/FormField"
import { STACK_SM } from "~/ui/recipes/layout"

import { investorLabel, isSelectableInvestor } from "./investorQueries"

export type InvestorChoice = Readonly<{ userId: string; label: string }>

export type InvestorPickerProps = Readonly<{
  userId: string
  hint: string
  disabled?: boolean
  onChange: (choice: InvestorChoice) => void
}>

export const InvestorPicker = ({
  userId,
  hint,
  disabled = false,
  onChange,
}: InvestorPickerProps): React.ReactElement => {
  const [query, setQuery] = useState("")
  const search = query.trim()
  const investors = useAdminUsers(search === "" ? { segment: "clients" } : { segment: "clients", q: search })
  const failed = investors.data === undefined && investors.error != null

  const options = useMemo(
    () =>
      (investors.data?.items ?? []).filter(isSelectableInvestor).map((user) => ({
        value: user.id,
        label: investorLabel(user),
        hint: [user.email, user.phone].filter((part) => part !== "").join(" · "),
      })),
    [investors.data],
  )

  return (
    <div className={STACK_SM}>
      <FormField
        label="Investor"
        required
        hint={hint}
        error={failed ? "The investor list could not be loaded, so no investor can be chosen." : undefined}
      >
        {({ id, invalid }) => (
          <Combobox
            id={id}
            options={options}
            value={userId}
            onChange={(next) => {
              onChange({
                userId: next,
                label: options.find((option) => option.value === next)?.label ?? "",
              })
            }}
            query={query}
            onQueryChange={setQuery}
            placeholder="Start typing a name"
            invalid={invalid}
            disabled={disabled}
            loading={investors.isFetching}
            emptyLabel={failed ? "Investors could not be loaded" : "No investor matches that"}
          />
        )}
      </FormField>
      {failed ? (
        <Button size="sm" tone="secondary" onClick={investors.refetch}>
          Load investors again
        </Button>
      ) : null}
    </div>
  )
}
