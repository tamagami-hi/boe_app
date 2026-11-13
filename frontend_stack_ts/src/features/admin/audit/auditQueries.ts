import { listAdminAuditTrail, listAdminUserAuditTrail } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type AuditPreset = "recordings" | "reversals" | "growth" | "maturity" | "refunds"

export type AuditTrailFilter = Readonly<{
  preset: AuditPreset | null
  entityType: string
  command: string
  fromDate: string
  toDate: string
}>

export type AuditTrail = DataOf<typeof listAdminAuditTrail>
export type AuditTrailItem = AuditTrail["items"][number]

const TRAIL_PAGE_LIMIT = 25

const textOrUndefined = (value: string): string | undefined => (value === "" ? undefined : value)

export const useAuditTrail = (filter: AuditTrailFilter): PagedQuery<AuditTrail> => {
  const api = useApi()
  const key = [filter.preset ?? "", filter.entityType, filter.command, filter.fromDate, filter.toDate].join("|")
  return usePagedQuery({
    queryKey: qk.admin.auditTrail(key),
    staleTime: STALE.MONEY,
    limit: TRAIL_PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminAuditTrail, {
        query: {
          limit: TRAIL_PAGE_LIMIT,
          after,
          preset: filter.preset ?? undefined,
          entityType: textOrUndefined(filter.entityType),
          command: textOrUndefined(filter.command),
          fromDate: textOrUndefined(filter.fromDate),
          toDate: textOrUndefined(filter.toDate),
        },
      }),
  })
}

export const useUserAuditTrail = (userId: string): PagedQuery<DataOf<typeof listAdminUserAuditTrail>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.userAuditTrail(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    limit: TRAIL_PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminUserAuditTrail, { params: { userId }, query: { limit: TRAIL_PAGE_LIMIT, after } }),
  })
}
