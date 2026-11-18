import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import type { z } from "zod"

import { ADMIN_CONFIRMATION_HEADER } from "@beonedge/contracts"
import { confirmAdminPassword, getAdminAppConfig, publishAdminAppConfig } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type AdminAppConfig = DataOf<typeof getAdminAppConfig>
export type AppConfigInput = z.input<typeof publishAdminAppConfig.request.body>
export type ConfirmedAppConfigInput = AppConfigInput & Readonly<{ confirmation: string }>
export type PublishAppConfigInput = ConfirmedAppConfigInput & Readonly<{ idempotencyKey: string }>
export type AdminPasswordConfirmation = DataOf<typeof confirmAdminPassword>

export const useAdminAppConfig = (): UseQueryResult<AdminAppConfig> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.appConfig(),
    staleTime: STALE.CONFIG,
    queryFn: async () => (await api.request(getAdminAppConfig)).data,
  })
}

export const useConfirmPublishPassword = (): UseMutationResult<AdminPasswordConfirmation, Error, string> => {
  const api = useApi()
  return useMutation({
    mutationFn: async (password: string) =>
      (await api.request(confirmAdminPassword, { body: { password, action: "app_config.publish" } })).data,
  })
}

export const usePublishAppConfig = (): UseMutationResult<AdminAppConfig, Error, PublishAppConfigInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, confirmation, ...body }: PublishAppConfigInput) =>
      (
        await api.request(publishAdminAppConfig, {
          body,
          idempotencyKey,
          headers: { [ADMIN_CONFIRMATION_HEADER]: confirmation },
        })
      ).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.appConfig() })
    },
  })
}
