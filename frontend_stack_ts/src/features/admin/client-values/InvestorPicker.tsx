import { useMemo, useState } from "react"

import { hasCode } from "~/api/errors"
import { useSession } from "~/app/providers/SessionProvider"
import { DIRECTORY_PAGE_LIMIT, useAdminUsers } from "~/features/admin/users/userDirectoryQueries"
import { Button } from "~/ui/primitives/Button"
import { Combobox } from "~/ui/primitives/Combobox"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_SM } from "~/ui/recipes/layout"

import { investorLabel, isSelectableInvestor } from "./investorQueries"

export type InvestorChoice = Readonly<{ userId: string; label: string }>

export type InvestorPickerProps = Readonly<{
  userId: string
  initialQuery?: string
  hint: string
  disabled?: boolean
  onChange: (choice: InvestorChoice) => void
}>

const LIST_PERMISSIONS = ["users.read", "users.read_limited"] as const

export const InvestorPicker = ({
  userId,
  initialQuery = "",
  hint,
  disabled = false,
  onChange,
}: InvestorPickerProps): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canList = hasAnyPermission(LIST_PERMISSIONS)
  const [query, setQuery] = useState(initialQuery)
  const search = query.trim()
  const investors = useAdminUsers(search === "" ? { segment: "clients" } : { segment: "clients", q: search }, canList)
  const denied = !canList || hasCode(investors.error, "AUTHORIZATION_DENIED")
  const failed = !denied && investors.data === undefined && investors.error != null
  const capped = investors.data !== undefined && investors.hasMore

  const options = useMemo(
    () =>
      (investors.data?.items ?? []).filter(isSelectableInvestor).map((user) => ({
        value: user.id,
        label: investorLabel(user),
        hint: [user.email, user.phone].filter((part) => part !== "").join(" · "),
      })),
    [investors.data],
  )

  if (denied) {
    return (
      <Alert tone="info" title="Investors cannot be listed">
        This role cannot list investors, so one cannot be chosen here.
      </Alert>
    )
  }

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
      {capped ? (
        <p className={PROSE_SM} role="status">
          {`Only the first ${String(DIRECTORY_PAGE_LIMIT)} matches are listed. Type more of the name, email or phone to find someone not shown.`}
        </p>
      ) : null}
      {failed ? (
        <Button size="sm" tone="secondary" onClick={investors.refetch}>
          Load investors again
        </Button>
      ) : null}
    </div>
  )
}
