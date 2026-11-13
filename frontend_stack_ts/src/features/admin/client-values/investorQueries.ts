import { listAdminUsers } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

const DIRECTORY_PAGE_LIMIT = 100

type DirectoryUser = DataOf<typeof listAdminUsers>["items"][number]

export const investorLabel = (user: Pick<DirectoryUser, "fullName" | "email">): string =>
  user.fullName === "" ? user.email : user.fullName

export const isSelectableInvestor = (user: Pick<DirectoryUser, "accountState" | "isPiiTombstoned">): boolean =>
  user.accountState !== "closed" && !user.isPiiTombstoned

export const useInvestorDirectory = (): PagedQuery<DataOf<typeof listAdminUsers>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.users("client-values:directory"),
    staleTime: STALE.MONEY,
    limit: DIRECTORY_PAGE_LIMIT,
    loadAll: true,
    fetchPage: async (after) =>
      api.request(listAdminUsers, { query: { limit: DIRECTORY_PAGE_LIMIT, after } }),
  })
}
