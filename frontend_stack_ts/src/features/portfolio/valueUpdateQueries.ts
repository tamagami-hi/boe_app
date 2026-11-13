import { listClientValueUpdates } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

const VALUE_UPDATES_PAGE_LIMIT = 25

export const useValueUpdates = (): PagedQuery<DataOf<typeof listClientValueUpdates>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.client.valueUpdates(),
    staleTime: STALE.MONEY,
    limit: VALUE_UPDATES_PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listClientValueUpdates, { query: { limit: VALUE_UPDATES_PAGE_LIMIT, after } }),
  })
}
