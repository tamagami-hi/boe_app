import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import { getAdminClientPasswordAccess, sendAdminClientPasswordLink } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type ClientPasswordAccess = DataOf<typeof getAdminClientPasswordAccess>
export type SentPasswordLink = DataOf<typeof sendAdminClientPasswordLink>

export const useAdminClientPasswordAccess = (userId: string): UseQueryResult<ClientPasswordAccess> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.clientPasswordAccess(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminClientPasswordAccess, { params: { userId } })).data,
  })
}

export const useSendClientPasswordLink = (
  userId: string,
): UseMutationResult<SentPasswordLink, Error, Readonly<{ idempotencyKey: string }>> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey }: Readonly<{ idempotencyKey: string }>) =>
      (await api.request(sendAdminClientPasswordLink, { params: { userId }, body: {}, idempotencyKey })).data,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.clientPasswordAccess(userId) })
    },
  })
}
