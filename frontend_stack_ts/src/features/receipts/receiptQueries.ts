import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import { getClientReceipt, listClientReceipts } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

const RECEIPT_PAGE_LIMIT = 25

export const useReceipts = (): PagedQuery<DataOf<typeof listClientReceipts>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.client.receipts(),
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listClientReceipts, { query: { limit: RECEIPT_PAGE_LIMIT, after } }),
  })
}

export const useReceipt = (entryId: string): UseQueryResult<DataOf<typeof getClientReceipt>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.receipt(entryId),
    enabled: entryId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getClientReceipt, { params: { entryId } })).data,
  })
}
