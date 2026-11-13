import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import { listClientSipSchedules } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type ClientSipSchedules = DataOf<typeof listClientSipSchedules>

export const useSipSchedules = (): UseQueryResult<ClientSipSchedules> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.sipSchedules(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listClientSipSchedules, {})).data,
  })
}
