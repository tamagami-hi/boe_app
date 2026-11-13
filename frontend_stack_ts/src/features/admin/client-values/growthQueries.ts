import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { QueryClient, UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import type { z } from "zod"

import {
  appendAdminIndividualClientGrowth,
  commitAdminCollectiveClientGrowth,
  listAdminFundClientPositions,
  previewAdminCollectiveClientGrowth,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type IndividualGrowthBody = z.input<typeof appendAdminIndividualClientGrowth.request.body>

export type IndividualGrowthInput = Readonly<{ idempotencyKey: string; body: IndividualGrowthBody }>

export type CollectiveGrowthPreviewInput = z.input<
  typeof previewAdminCollectiveClientGrowth.request.body
>

export type CollectiveGrowthCommitBody = z.input<
  typeof commitAdminCollectiveClientGrowth.request.body
>

export type CollectiveGrowthCommitInput = Readonly<{
  idempotencyKey: string
  body: CollectiveGrowthCommitBody
}>

const refreshInvestorValues = async (queryClient: QueryClient, userId?: string): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: userId === undefined ? ["admin", "investor"] : ["admin", "investor", userId],
    }),
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
    queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() }),
  ])
}

export const useIndividualClientGrowth = (): UseMutationResult<
  DataOf<typeof appendAdminIndividualClientGrowth>,
  Error,
  IndividualGrowthInput
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, body }: IndividualGrowthInput) =>
      (await api.request(appendAdminIndividualClientGrowth, { body, idempotencyKey })).data,
    onSettled: async (_data, _error, variables) => {
      await refreshInvestorValues(queryClient, variables.body.userId)
    },
  })
}

export const usePreviewCollectiveClientGrowth = (): UseMutationResult<
  DataOf<typeof previewAdminCollectiveClientGrowth>,
  Error,
  CollectiveGrowthPreviewInput
> => {
  const api = useApi()
  return useMutation({
    mutationFn: async (body: CollectiveGrowthPreviewInput) =>
      (await api.request(previewAdminCollectiveClientGrowth, { body })).data,
  })
}

export const useCommitCollectiveClientGrowth = (): UseMutationResult<
  DataOf<typeof commitAdminCollectiveClientGrowth>,
  Error,
  CollectiveGrowthCommitInput
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, body }: CollectiveGrowthCommitInput) =>
      (await api.request(commitAdminCollectiveClientGrowth, { body, idempotencyKey })).data,
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        refreshInvestorValues(queryClient),
        queryClient.invalidateQueries({ queryKey: qk.admin.fundClientPositions(variables.body.fundId) }),
      ])
    },
  })
}

export const useFundClientPositions = (
  fundId: string,
): UseQueryResult<DataOf<typeof listAdminFundClientPositions>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.fundClientPositions(fundId),
    enabled: fundId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listAdminFundClientPositions, { params: { fundId } })).data,
  })
}
