import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import { chooseClientMaturityOption, getClientMaturityOffer, listClientMaturityOffers } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type MaturityOffer = DataOf<typeof getClientMaturityOffer>["offer"]
export type MaturityOptionKey = "return_all" | "one_time_and_sip" | "sip_extension"

export type ChooseMaturityOptionInput = Readonly<{
  offerId: string
  option: MaturityOptionKey
  expectedVersion: number
  idempotencyKey: string
}>

export const useMaturityOffers = (): UseQueryResult<DataOf<typeof listClientMaturityOffers>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.maturityOffers(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listClientMaturityOffers)).data,
  })
}

export const useMaturityOffer = (offerId: string): UseQueryResult<MaturityOffer> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.maturityOffer(offerId),
    enabled: offerId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getClientMaturityOffer, { params: { offerId } })).data.offer,
  })
}

export const useChooseMaturityOption = (): UseMutationResult<MaturityOffer, Error, ChooseMaturityOptionInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ offerId, idempotencyKey, ...body }: ChooseMaturityOptionInput) =>
      (await api.request(chooseClientMaturityOption, { params: { offerId }, body, idempotencyKey })).data.offer,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.client.maturityOffers() })
    },
  })
}
