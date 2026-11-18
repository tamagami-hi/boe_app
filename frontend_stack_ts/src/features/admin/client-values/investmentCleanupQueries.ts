import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  confirmAdminEarlierGrowthSplit,
  getAdminClientInvestments,
  listAdminInvestmentsToCategorise,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery, type PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

import type { SplitBody } from "./earlierGrowthSplit"
import type { InvestmentRef } from "./investmentCleanup"

export type AdminClientInvestments = DataOf<typeof getAdminClientInvestments>
export type InvestmentsToCategorise = DataOf<typeof listAdminInvestmentsToCategorise>
export type EarlierGrowthSplitResult = DataOf<typeof confirmAdminEarlierGrowthSplit>

export type EarlierGrowthSplitInput = SplitBody<InvestmentRef> & Readonly<{ fundId: string }>

type Keyed<T> = T & Readonly<{ idempotencyKey: string }>

const TO_CATEGORISE_PAGE_LIMIT = 50

export const useClientInvestments = (userId: string, enabled = true): UseQueryResult<AdminClientInvestments> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.clientInvestments(userId),
    enabled: enabled && userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminClientInvestments, { params: { userId } })).data,
  })
}

export const useInvestmentsToCategorise = (enabled: boolean): PagedQuery<InvestmentsToCategorise> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.investmentsToCategorise(),
    enabled,
    staleTime: STALE.MONEY,
    limit: TO_CATEGORISE_PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminInvestmentsToCategorise, { query: { limit: TO_CATEGORISE_PAGE_LIMIT, after } }),
  })
}

export const useRefreshInvestments = (userId: string): (() => Promise<void>) => {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.admin.clientInvestments(userId) }),
      queryClient.invalidateQueries({ queryKey: qk.admin.investmentsToCategorise() }),
    ])
  }
}

export const useConfirmEarlierGrowthSplit = (
  userId: string,
): UseMutationResult<EarlierGrowthSplitResult, Error, Keyed<EarlierGrowthSplitInput>> => {
  const api = useApi()
  const refresh = useRefreshInvestments(userId)
  return useMutation({
    mutationFn: async ({ idempotencyKey, fundId, cutoffEntryId, parts }: Keyed<EarlierGrowthSplitInput>) =>
      (
        await api.request(confirmAdminEarlierGrowthSplit, {
          params: { userId, fundId },
          body: { cutoffEntryId, parts: parts.map((part) => ({ ...part })) },
          idempotencyKey,
        })
      ).data,
    onSettled: refresh,
  })
}
