import { useMemo } from "react"

import { isApiError } from "~/api/errors"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"

import { useAdminFundCatalogue } from "./queries"

export type FundNames = Readonly<{
  ready: boolean
  nameOf: (fundId: string, fallback?: string | null) => string
  notice: React.ReactElement | null
}>

const NAME_PENDING = "Loading the fund name"
const NAME_FAILED = "Fund name not loaded"
const NAME_UNKNOWN = "Fund not in the fund list"

export const useFundNames = (): FundNames => {
  const funds = useAdminFundCatalogue()
  const names = useMemo(
    () => new Map((funds.data?.items ?? []).map((fund) => [fund.id, fund.name ?? fund.slug])),
    [funds.data],
  )
  const ready = funds.data !== undefined
  const failed = !ready && funds.error != null
  const denied = failed && isApiError(funds.error) && funds.error.code === "AUTHORIZATION_DENIED"
  const missing = ready ? NAME_UNKNOWN : failed ? NAME_FAILED : NAME_PENDING

  const notice = !failed ? null : denied ? (
    <Alert tone="info" title="Fund names not shown">
      This role cannot read the fund list, so funds are not named here.
    </Alert>
  ) : (
    <Alert
      tone="error"
      title="Fund names not loaded"
      action={
        <Button size="sm" tone="secondary" loading={funds.isFetching} onClick={funds.refetch}>
          Try again
        </Button>
      }
    >
      The fund list could not be read, so funds are not named here until it loads.
    </Alert>
  )

  return {
    ready,
    nameOf: (fundId, fallback) => names.get(fundId) ?? fallback ?? missing,
    notice,
  }
}
