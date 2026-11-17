import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query"

import { listAdminWithdrawalPayoutOutcomes } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type AdminPayoutOutcomes = DataOf<typeof listAdminWithdrawalPayoutOutcomes>

const OUTCOME_LIMIT = 100

export const useWithdrawalPayoutOutcomes = (userId: string): UseQueryResult<AdminPayoutOutcomes> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.clientWithdrawalPayoutOutcomes(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () =>
      (await api.request(listAdminWithdrawalPayoutOutcomes, { params: { userId }, query: { limit: OUTCOME_LIMIT } })).data,
  })
}

export const useReloadPayoutOutcomes = (userId: string): (() => void) => {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.admin.clientWithdrawalPayoutOutcomes(userId) })
  }
}
