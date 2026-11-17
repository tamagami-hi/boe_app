import type { AdminUserAccountState, AdminUserDirectorySegment } from "@beonedge/contracts"

import { listAdminUsers } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export const DIRECTORY_PAGE_LIMIT = 25

export type AdminUserFilter = Readonly<{
  status?: AdminUserAccountState
  q?: string
  segment?: AdminUserDirectorySegment
}>

export const useAdminUsers = (filter: AdminUserFilter, enabled = true): PagedQuery<DataOf<typeof listAdminUsers>> => {
  const api = useApi()
  const key = `${filter.status ?? "any"}:${filter.q ?? ""}:${filter.segment ?? "everyone"}`
  return usePagedQuery({
    queryKey: qk.admin.users(key),
    enabled,
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminUsers, {
        query: {
          limit: DIRECTORY_PAGE_LIMIT,
          after,
          ...(filter.status === undefined ? {} : { status: filter.status }),
          ...(filter.q === undefined || filter.q === "" ? {} : { q: filter.q }),
          ...(filter.segment === undefined ? {} : { segment: filter.segment }),
        },
      }),
  })
}
