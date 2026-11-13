import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import { eraseAdminClient, getAdminClientErasureCheck } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type ErasureCheck = DataOf<typeof getAdminClientErasureCheck>
export type ErasureOutcome = DataOf<typeof eraseAdminClient>
export type ErasurePath = ErasureCheck["path"]

export type ErasureInput = Readonly<{
  expectedPath: ErasurePath
  idempotencyKey: string
}>

export const ERASE_CONFIRMATION = "ERASE"

export const useClientErasureCheck = (userId: string): UseQueryResult<ErasureCheck> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.clientErasureCheck(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminClientErasureCheck, { params: { userId } })).data,
  })
}

export const useEraseClient = (userId: string): UseMutationResult<ErasureOutcome, Error, ErasureInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ expectedPath, idempotencyKey }: ErasureInput) =>
      (
        await api.request(eraseAdminClient, {
          params: { userId },
          body: { confirm: ERASE_CONFIRMATION, expectedPath },
          idempotencyKey,
        })
      ).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.clientErasureCheck(userId) })
      await queryClient.invalidateQueries({ queryKey: qk.admin.user(userId) })
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}
