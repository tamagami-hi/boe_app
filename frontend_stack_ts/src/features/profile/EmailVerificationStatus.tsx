import type { ReactNode } from "react"

import { clientEmailVerification } from "~/domain/clientStatus"
import { InlineReadFailure } from "~/features/shared/InlineReadFailure"
import { useEligibility } from "~/features/shared/queries"
import { StatusBadge } from "~/ui/patterns/StatusBadge"

export const useEmailVerificationStatus = (className?: string): ReactNode => {
  const eligibility = useEligibility()

  if (eligibility.data !== undefined) {
    const state = eligibility.data.emailVerificationState
    return state === null ? null : <StatusBadge status={clientEmailVerification(state)} />
  }

  if (eligibility.isError) {
    return (
      <InlineReadFailure
        className={className}
        retrying={eligibility.isFetching}
        onRetry={() => {
          void eligibility.refetch()
        }}
      />
    )
  }

  return <span className={className}>Checking&hellip;</span>
}
