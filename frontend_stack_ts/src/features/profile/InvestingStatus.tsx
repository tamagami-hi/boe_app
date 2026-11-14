import { InlineReadFailure } from "~/features/shared/InlineReadFailure"
import { useEligibility } from "~/features/shared/queries"

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
