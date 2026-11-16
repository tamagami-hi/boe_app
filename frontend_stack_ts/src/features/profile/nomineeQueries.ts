import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  getClientNominee,
  getLatestClientNomineeRequest,
  sendClientNomineeRequest,
  withdrawClientNomineeRequest,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useSealedMutation, type SealedMutationResult } from "~/api/sealedMutation"
import { useApi } from "~/app/providers/ApiProvider"
import type { RequestedNominee } from "~/domain/nominee"

export type ClientNominee = DataOf<typeof getClientNominee>
export type LatestNomineeRequest = DataOf<typeof getLatestClientNomineeRequest>
export type NomineeRequest = DataOf<typeof sendClientNomineeRequest>["request"]

export type SendNomineeRequestInput = RequestedNominee & Readonly<{ currentPassword: string; idempotencyKey: string }>

export type WithdrawNomineeRequestInput = Readonly<{
  requestId: string
  expectedVersion: number
  idempotencyKey: string
}>

export const useClientNominee = (): UseQueryResult<ClientNominee> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.nominee(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getClientNominee, {})).data,
  })
}

export const useLatestNomineeRequest = (): UseQueryResult<LatestNomineeRequest> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.nomineeRequest(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getLatestClientNomineeRequest, {})).data,
  })
}

export const useSendNomineeRequest = (): SealedMutationResult<NomineeRequest, SendNomineeRequestInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useSealedMutation({
    mutationFn: async ({ idempotencyKey, ...body }: SendNomineeRequestInput) =>
      (await api.request(sendClientNomineeRequest, { body, idempotencyKey })).data.request,
    onSuccess: (request) => {
      queryClient.setQueryData(qk.client.nomineeRequest(), { request })
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.client.nomineeRequest() })
    },
  })
}

export const useWithdrawNomineeRequest = (): UseMutationResult<NomineeRequest, Error, WithdrawNomineeRequestInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ requestId, idempotencyKey, ...body }: WithdrawNomineeRequestInput) =>
      (await api.request(withdrawClientNomineeRequest, { params: { requestId }, body, idempotencyKey })).data.request,
    onSuccess: (request) => {
      queryClient.setQueryData(qk.client.nomineeRequest(), { request })
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.client.nomineeRequest() })
    },
  })
}
