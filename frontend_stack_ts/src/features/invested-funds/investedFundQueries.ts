import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import {
  getClientInvestedFund,
  listClientInvestedFunds,
  listClientReceipts,
  listClientValueUpdates,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

const FUND_PAGE_LIMIT = 25

export type InvestedFunds = DataOf<typeof listClientInvestedFunds>

export const useInvestedFunds = (): UseQueryResult<InvestedFunds> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.investedFunds(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listClientInvestedFunds, {})).data,
  })
}

export const useInvestedFund = (fundId: string): UseQueryResult<DataOf<typeof getClientInvestedFund>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.investedFund(fundId),
    enabled: fundId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getClientInvestedFund, { params: { fundId } })).data,
  })
}

export const useFundReceipts = (fundId: string): PagedQuery<DataOf<typeof listClientReceipts>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.client.fundReceipts(fundId),
    staleTime: STALE.MONEY,
    limit: FUND_PAGE_LIMIT,
    enabled: fundId !== "",
    fetchPage: async (after) =>
      api.request(listClientReceipts, { query: { limit: FUND_PAGE_LIMIT, after, fundId } }),
  })
}

export const useFundValueUpdates = (fundId: string): PagedQuery<DataOf<typeof listClientValueUpdates>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.client.fundValueUpdates(fundId),
    staleTime: STALE.MONEY,
    limit: FUND_PAGE_LIMIT,
    enabled: fundId !== "",
    fetchPage: async (after) =>
      api.request(listClientValueUpdates, { query: { limit: FUND_PAGE_LIMIT, after, fundId } }),
  })
}
