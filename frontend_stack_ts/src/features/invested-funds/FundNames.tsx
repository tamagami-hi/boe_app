import { Button } from "~/ui/primitives/Button"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { useInvestedFunds } from "./investedFundQueries"

const NAME_UNAVAILABLE = "Fund name unavailable"

export type FundNames = Readonly<{
  nameOf: (fundId: string) => string | null
  isPending: boolean
  isFailed: boolean
  isRetrying: boolean
  retry: () => void
}>

export const useFundNames = (): FundNames => {
  const query = useInvestedFunds()
  const items = query.data?.items ?? []
  return {
    nameOf: (fundId) => items.find((item) => item.fundId === fundId)?.fundName ?? null,
    isPending: query.data === undefined && query.isPending,
    isFailed: query.data === undefined && query.isError,
    isRetrying: query.isFetching,
    retry: () => {
      void query.refetch()
    },
  }
}

export type FundNameProps = Readonly<{ names: FundNames; fundId: string }>

export const FundName = ({ names, fundId }: FundNameProps): React.ReactElement =>
  names.isPending ? <Skeleton width="7rem" /> : <>{names.nameOf(fundId) ?? NAME_UNAVAILABLE}</>

export type FundNamesFailureProps = Readonly<{ names: FundNames }>

export const FundNamesFailure = ({ names }: FundNamesFailureProps): React.ReactElement | null =>
  names.isFailed ? (
    <Alert
      tone="error"
      title="Fund names could not be loaded"
      action={
        <Button tone="secondary" size="sm" loading={names.isRetrying} onClick={names.retry}>
          Try again
        </Button>
      }
    >
      The amounts below are shown without their fund names until this loads.
    </Alert>
  ) : null
