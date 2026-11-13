import type { ReactNode } from "react"

import { Page } from "~/app/layouts/Page"
import { useEligibility } from "~/features/shared/queries"
import { errorVariantOf } from "~/ui/patterns/AsyncBoundary"
import { ErrorState } from "~/ui/patterns/ErrorState"
import { Spinner } from "~/ui/primitives/Feedback"

export const EligibilityReadCheck = ({ children }: Readonly<{ children: ReactNode }>): React.ReactElement => {
  const eligibility = useEligibility()

  if (eligibility.data !== undefined || !eligibility.isError) return <>{children}</>

  if (eligibility.isFetching) {
    return (
      <Page width="form">
        <Spinner size="md" label="Checking whether you can invest" />
      </Page>
    )
  }

  return (
    <Page width="form">
      <ErrorState
        variant={errorVariantOf(eligibility.error, false)}
        onRetry={() => {
          void eligibility.refetch()
        }}
      />
    </Page>
  )
}
