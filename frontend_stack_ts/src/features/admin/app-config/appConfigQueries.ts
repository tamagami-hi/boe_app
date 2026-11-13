import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import type { z } from "zod"

import { getAdminAppConfig, publishAdminAppConfig } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type AdminAppConfig = DataOf<typeof getAdminAppConfig>
export type AppConfigInput = z.input<typeof publishAdminAppConfig.request.body>
export type PublishAppConfigInput = AppConfigInput & Readonly<{ idempotencyKey: string }>

export const useAdminAppConfig = (): UseQueryResult<AdminAppConfig> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.appConfig(),
    staleTime: STALE.CONFIG,
    queryFn: async () => (await api.request(getAdminAppConfig)).data,
  })
}

export const usePublishAppConfig = (): UseMutationResult<AdminAppConfig, Error, PublishAppConfigInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: PublishAppConfigInput) =>
      (await api.request(publishAdminAppConfig, { body, idempotencyKey })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.appConfig() })
    },
  })
}
