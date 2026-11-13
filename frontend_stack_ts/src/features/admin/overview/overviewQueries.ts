import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import { getAdminPendingInvites, listAdminEmailDeliveries, listAdminFundValueUpdates } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

const FAILED_EMAIL_PAGE_LIMIT = 100

export const usePendingInvites = (enabled: boolean): UseQueryResult<DataOf<typeof getAdminPendingInvites>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.pendingInvites(),
    enabled,
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminPendingInvites)).data,
  })
}

export const useFundValueUpdates = (enabled: boolean): UseQueryResult<DataOf<typeof listAdminFundValueUpdates>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.fundValueUpdates(),
    enabled,
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listAdminFundValueUpdates)).data,
  })
}

export const useFailedEmails = (enabled: boolean): PagedQuery<DataOf<typeof listAdminEmailDeliveries>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.emailDeliveries("overview:permanent_failed"),
    enabled,
    staleTime: STALE.MONEY,
    limit: FAILED_EMAIL_PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminEmailDeliveries, {
        query: { state: "permanent_failed", limit: FAILED_EMAIL_PAGE_LIMIT, after },
      }),
  })
}
