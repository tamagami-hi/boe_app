import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import { changeAdminUserNominee, getAdminUserNominee } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import type { NomineeInput } from "~/domain/nominee"

export type AdminUserNominee = DataOf<typeof getAdminUserNominee>
export type AdminNomineeChange = DataOf<typeof changeAdminUserNominee>

export type AdminNomineeChangeInput = Readonly<{ input: NomineeInput; expectedVersion: number; idempotencyKey: string }>

export const useAdminUserNominee = (userId: string): UseQueryResult<AdminUserNominee> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.userNominee(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminUserNominee, { params: { userId } })).data,
  })
}

export const useChangeAdminUserNominee = (
  userId: string,
): UseMutationResult<AdminNomineeChange, Error, AdminNomineeChangeInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, expectedVersion, idempotencyKey }: AdminNomineeChangeInput) =>
      (
        await api.request(changeAdminUserNominee, {
          params: { userId },
          body: { ...input, expectedVersion },
          idempotencyKey,
        })
      ).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.user(userId) })
    },
  })
}
