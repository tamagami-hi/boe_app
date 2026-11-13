import { useEligibility } from "~/features/shared/queries"
import { Button } from "~/ui/primitives/Button"

import { INVESTING_UNKNOWN } from "./profile.recipe"

export type InvestingStatusProps = Readonly<{
  availableLabel: string
  className?: string | undefined
}>

export const InvestingStatus = ({
  availableLabel,
  className,
}: InvestingStatusProps): React.ReactElement => {
  const eligibility = useEligibility()

  if (eligibility.data !== undefined) {
    return (
      <span className={className}>{eligibility.data.canInvest ? availableLabel : "Locked"}</span>
    )
  }

  if (eligibility.isError) {
    return (
      <span className={INVESTING_UNKNOWN}>
        <span className={className}>Couldn&rsquo;t check</span>
        <Button
          tone="ghost"
          size="sm"
          loading={eligibility.isFetching}
          onClick={() => {
            void eligibility.refetch()
          }}
        >
          Try again
        </Button>
      </span>
    )
  }

  return <span className={className}>Checking&hellip;</span>
}
