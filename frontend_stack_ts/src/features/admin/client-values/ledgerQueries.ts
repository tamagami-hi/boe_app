import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import { listAdminClientLedgerEntries } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export const LEDGER_ENTRY_LIMIT = 100

export const useAdminClientLedgerEntries = (
  userId: string,
  fundId: string,
): UseQueryResult<DataOf<typeof listAdminClientLedgerEntries>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.clientLedgerEntries(userId, fundId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () =>
      (
        await api.request(listAdminClientLedgerEntries, {
          params: { userId },
          query: { limit: LEDGER_ENTRY_LIMIT, ...(fundId === "" ? {} : { fundId }) },
        })
      ).data,
  })
}
