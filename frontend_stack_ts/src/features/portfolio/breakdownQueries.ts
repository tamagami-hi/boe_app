import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import { getClientInvestmentBreakdown } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type InvestmentBreakdown = DataOf<typeof getClientInvestmentBreakdown>
export type FundBreakdown = InvestmentBreakdown["funds"][number]
export type SipBreakdown = FundBreakdown["sips"][number]
export type OneTimeBreakdown = FundBreakdown["oneTime"][number]
export type BreakdownLine = FundBreakdown["lines"][number]

export const useInvestmentBreakdown = (): UseQueryResult<InvestmentBreakdown> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.investmentBreakdown(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getClientInvestmentBreakdown, {})).data,
  })
}
