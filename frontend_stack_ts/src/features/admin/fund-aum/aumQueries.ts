import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { QueryClient, UseMutationResult } from "@tanstack/react-query"
import type { z } from "zod"

import {
  appendAdminFundAumGrowth,
  commitAdminCollectiveAumGrowth,
  initializeAdminFundAum,
  previewAdminCollectiveAumGrowth,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

type Keyed = Readonly<{ idempotencyKey: string }>

export type AumInitializeInput = z.input<typeof initializeAdminFundAum.request.body>
export type AumGrowthInput = z.input<typeof appendAdminFundAumGrowth.request.body>
export type CollectivePreviewInput = z.input<typeof previewAdminCollectiveAumGrowth.request.body>
export type CollectiveCommitInput = z.input<typeof commitAdminCollectiveAumGrowth.request.body>
export type CollectivePreview = DataOf<typeof previewAdminCollectiveAumGrowth>
export type CollectiveCommitted = DataOf<typeof commitAdminCollectiveAumGrowth>

const refreshFund = async (queryClient: QueryClient, fundId: string): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) }),
    queryClient.invalidateQueries({ queryKey: ["admin", "funds"] }),
    queryClient.invalidateQueries({ queryKey: qk.client.fund(fundId) }),
    queryClient.invalidateQueries({ queryKey: qk.client.funds() }),
  ])
}

export const useInitializeAum = (fundId: string): UseMutationResult<void, Error, AumInitializeInput & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: AumInitializeInput & Keyed) => {
      await api.request(initializeAdminFundAum, { params: { fundId }, body, idempotencyKey })
    },
    onSuccess: async () => {
      await refreshFund(queryClient, fundId)
    },
  })
}

export const useAppendAumGrowth = (fundId: string): UseMutationResult<void, Error, AumGrowthInput & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: AumGrowthInput & Keyed) => {
      await api.request(appendAdminFundAumGrowth, { params: { fundId }, body, idempotencyKey })
    },
    onSuccess: async () => {
      await refreshFund(queryClient, fundId)
    },
  })
}

export const useCollectivePreview = (): UseMutationResult<CollectivePreview, Error, CollectivePreviewInput> => {
  const api = useApi()
  return useMutation({
    mutationFn: async (body: CollectivePreviewInput) =>
      (await api.request(previewAdminCollectiveAumGrowth, { body })).data,
  })
}

export const useCommitCollectiveAumGrowth = (): UseMutationResult<
  CollectiveCommitted,
  Error,
  CollectiveCommitInput & Keyed
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: CollectiveCommitInput & Keyed) =>
      (await api.request(commitAdminCollectiveAumGrowth, { body, idempotencyKey })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "funds"] })
      await queryClient.invalidateQueries({ queryKey: ["admin", "fund"] })
    },
  })
}
