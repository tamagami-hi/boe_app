import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import { getAdminFund, getAdminFundAumHistory, listAdminFunds } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type AdminFundListFilter = Readonly<{
  state?: "draft" | "published" | "paused" | "archived"
  search?: string
}>

const LIST_PAGE_LIMIT = 25

export const useAdminFunds = (
  filter: AdminFundListFilter,
): PagedQuery<DataOf<typeof listAdminFunds>> => {
  const api = useApi()
  const key = `${filter.state ?? "any"}:${filter.search ?? ""}`
  return usePagedQuery({
    queryKey: qk.admin.funds(key),
    staleTime: STALE.CATALOGUE,
    fetchPage: async (after) =>
      api.request(listAdminFunds, {
        query: {
          limit: LIST_PAGE_LIMIT,
          after,
          ...(filter.state === undefined ? {} : { state: filter.state }),
          ...(filter.search === undefined || filter.search === ""
            ? {}
            : { search: filter.search }),
        },
      }),
  })
}

/**
 * Every fund, walked to the end of the cursor chain. The growth and AUM screens
 * put this in a picker, so a fund missing from the list is a fund an
 * administrator cannot act on.
 */
export const useAdminFundCatalogue = (): PagedQuery<DataOf<typeof listAdminFunds>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.funds("any:"),
    staleTime: STALE.CATALOGUE,
    loadAll: true,
    fetchPage: async (after) =>
      api.request(listAdminFunds, { query: { limit: LIST_PAGE_LIMIT, after } }),
  })
}

export const useAdminFund = (fundId: string): UseQueryResult<DataOf<typeof getAdminFund>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.fund(fundId),
    enabled: fundId !== "",
    staleTime: STALE.CATALOGUE,
    queryFn: async () => (await api.request(getAdminFund, { params: { fundId } })).data,
  })
}

export const useAdminAumHistory = (
  fundId: string,
): PagedQuery<DataOf<typeof getAdminFundAumHistory>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.fundAumHistory(fundId, "all"),
    enabled: fundId !== "",
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(getAdminFundAumHistory, {
        params: { fundId },
        query: { limit: LIST_PAGE_LIMIT, after },
      }),
  })
}
