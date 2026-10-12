import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  previewAppUpdateAnnouncement,
  sendAppUpdateAnnouncement,
  sendTestAppUpdateAnnouncement,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type AppUpdatePreview = DataOf<typeof previewAppUpdateAnnouncement>
export type SentAppUpdate = DataOf<typeof sendAppUpdateAnnouncement>
export type SentAppUpdateTest = DataOf<typeof sendTestAppUpdateAnnouncement>

export type AppUpdateRequest = Readonly<{ versionCode: number; mandatory: boolean; message?: string }>

type Keyed<T> = T & Readonly<{ idempotencyKey: string }>

export const useAppUpdatePreview = (mandatory: boolean, message: string): UseQueryResult<AppUpdatePreview> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.appUpdatePreview(mandatory, message),
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (
        await api.request(previewAppUpdateAnnouncement, {
          query: { mandatory: mandatory ? "true" : "false", ...(message === "" ? {} : { message }) },
        })
      ).data,
  })
}

const useRefreshAfterAnnouncement = () => {
  const queryClient = useQueryClient()
  return async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "app-update-preview"] })
    await queryClient.invalidateQueries({ queryKey: ["admin", "email-deliveries"] })
    await queryClient.invalidateQueries({ queryKey: qk.admin.appConfig() })
  }
}

export const useSendAppUpdate = (): UseMutationResult<SentAppUpdate, Error, Keyed<AppUpdateRequest>> => {
  const api = useApi()
  const refresh = useRefreshAfterAnnouncement()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: Keyed<AppUpdateRequest>) =>
      (await api.request(sendAppUpdateAnnouncement, { body, idempotencyKey })).data,
    onSuccess: refresh,
  })
}

export const useSendTestAppUpdate = (): UseMutationResult<SentAppUpdateTest, Error, Keyed<AppUpdateRequest>> => {
  const api = useApi()
  const refresh = useRefreshAfterAnnouncement()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: Keyed<AppUpdateRequest>) =>
      (await api.request(sendTestAppUpdateAnnouncement, { body, idempotencyKey })).data,
    onSuccess: refresh,
  })
}
