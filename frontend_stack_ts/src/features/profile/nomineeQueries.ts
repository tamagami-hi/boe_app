import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import { changeClientNominee, getClientNominee } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import type { NomineeInput } from "~/domain/nominee"

export type ClientNominee = DataOf<typeof getClientNominee>
export type ClientNomineeChange = DataOf<typeof changeClientNominee>

export const useClientNominee = (): UseQueryResult<ClientNominee> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.nominee(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getClientNominee, {})).data,
  })
}

export type ClientNomineeChangeInput = Readonly<{ input: NomineeInput; currentPassword: string }>

export const useChangeClientNominee = (): UseMutationResult<ClientNomineeChange, Error, ClientNomineeChangeInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, currentPassword }: ClientNomineeChangeInput) =>
      (await api.request(changeClientNominee, { body: { ...input, currentPassword } })).data,
    onSuccess: (result) => {
      queryClient.setQueryData(qk.client.nominee(), {
        userId: result.userId,
        nominee: result.nominee,
        version: result.version,
      })
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.client.profile() })
    },
  })
}
