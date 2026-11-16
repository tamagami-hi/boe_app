import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import { listClientSipEarlyExits } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type ClientSipEarlyExits = DataOf<typeof listClientSipEarlyExits>
export type ClientSipEarlyExit = ClientSipEarlyExits["items"][number]

export const EARLY_EXIT_LABEL = "Early exit"

export const useSipEarlyExits = (): UseQueryResult<ClientSipEarlyExits> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.sipEarlyExits(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listClientSipEarlyExits, {})).data,
  })
}

export const earlyExitText = (exit: ClientSipEarlyExit, date: string, amount: string): string =>
  `Early exit: your SIP in ${exit.fundName} was closed early on ${date}, and its full value, ${amount}, was withdrawn. It is counted under Withdrawals.`
