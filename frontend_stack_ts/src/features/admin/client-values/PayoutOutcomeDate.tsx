import { formatDate } from "~/domain/dates"

import { useWithdrawalPayoutOutcomes, type AdminPayoutOutcomes } from "./payoutOutcomeQueries"

type SettledState = "paid" | "failed"

type Props = Readonly<{ userId: string; payoutId: string; state: SettledState }>

type OutcomeLookup = Readonly<{ at: string | null; isStale: boolean }>

const UNAVAILABLE: Readonly<Record<SettledState, string>> = {
  paid: "Paid date unavailable",
  failed: "Failure date unavailable",
}

const outcomeAt = (data: AdminPayoutOutcomes | undefined, payoutId: string, state: SettledState): OutcomeLookup => {
  const item = data?.items.find((row) => row.payoutId === payoutId)
  if (item === undefined) return { at: null, isStale: false }
  if (item.state !== state) return { at: null, isStale: true }
  return { at: state === "paid" ? item.paidAt : item.failedAt, isStale: false }
}

export const PayoutOutcomeDate = ({ userId, payoutId, state }: Props): React.ReactElement | null => {
  const outcomes = useWithdrawalPayoutOutcomes(userId)
  const { at, isStale } = outcomeAt(outcomes.data, payoutId, state)
  if (at !== null) return <p>{`${state === "paid" ? "Paid" : "Failed"} on ${formatDate(at)}`}</p>
  if (outcomes.isPending || outcomes.isFetching || (isStale && !outcomes.isError)) return null
  return <p>{UNAVAILABLE[state]}</p>
}
