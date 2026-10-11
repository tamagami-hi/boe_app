import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  changeClientPhone,
  confirmClientEmailChange,
  getClientProfile,
  requestClientEmailChange,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type ClientProfile = DataOf<typeof getClientProfile>
export type PhoneChange = DataOf<typeof changeClientPhone>

export const useClientProfile = (): UseQueryResult<ClientProfile> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.profile(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getClientProfile, {})).data,
  })
}

export const useChangeClientPhone = (): UseMutationResult<
  PhoneChange,
  Error,
  Readonly<{ phone: string; currentPassword: string }>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: Readonly<{ phone: string; currentPassword: string }>) =>
      (await api.request(changeClientPhone, { body })).data,
    onSuccess: (result) => {
      queryClient.setQueryData(qk.client.profile(), result.profile)
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.client.profile() })
    },
  })
}

export type EmailChangeRequested = DataOf<typeof requestClientEmailChange>

export const useRequestEmailChange = (): UseMutationResult<
  EmailChangeRequested,
  Error,
  Readonly<{ newEmail: string; currentPassword: string }>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: Readonly<{ newEmail: string; currentPassword: string }>) =>
      (await api.request(requestClientEmailChange, { body })).data,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.client.profile() })
    },
  })
}

export const useConfirmEmailChange = (): UseMutationResult<
  DataOf<typeof confirmClientEmailChange>,
  Error,
  Readonly<{ code: string }>
> => {
  const api = useApi()
  return useMutation({
    mutationFn: async (body: Readonly<{ code: string }>) =>
      (await api.request(confirmClientEmailChange, { body })).data,
  })
}
