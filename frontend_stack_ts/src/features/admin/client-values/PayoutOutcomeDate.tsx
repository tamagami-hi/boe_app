import { formatDate } from "~/domain/dates"

import { useWithdrawalPayoutOutcomes, type AdminPayoutOutcomes } from "./payoutOutcomeQueries"

type SettledState = "paid" | "failed"

type Props = Readonly<{ userId: string; payoutId: string; state: SettledState }>

const UNAVAILABLE: Readonly<Record<SettledState, string>> = {
  paid: "Paid date unavailable",
  failed: "Failure date unavailable",
}

const outcomeAt = (data: AdminPayoutOutcomes | undefined, payoutId: string, state: SettledState): string | null => {
  const item = data?.items.find((row) => row.payoutId === payoutId)
  if (item === undefined) return null
  return state === "paid" ? item.paidAt : item.failedAt
}

export const PayoutOutcomeDate = ({ userId, payoutId, state }: Props): React.ReactElement | null => {
  const outcomes = useWithdrawalPayoutOutcomes(userId)
  const at = outcomeAt(outcomes.data, payoutId, state)
  if (at !== null) return <p>{`${state === "paid" ? "Paid" : "Failed"} on ${formatDate(at)}`}</p>
  if (outcomes.isPending || outcomes.isFetching) return null
  return <p>{UNAVAILABLE[state]}</p>
}
