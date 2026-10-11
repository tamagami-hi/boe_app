import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import { getAppConfig } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

const CONFIG_STALE_MS = 300_000
const MAINTENANCE_INTERVAL_MS = 30_000

export type AppConfigFeed = DataOf<typeof getAppConfig>

export const useAppConfigFeed = (underMaintenance: boolean): UseQueryResult<AppConfigFeed> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.app.config(),
    staleTime: underMaintenance ? 0 : CONFIG_STALE_MS,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: underMaintenance ? MAINTENANCE_INTERVAL_MS : false,
    queryFn: async () => (await api.request(getAppConfig, { unauthenticated: true })).data,
  })
}
