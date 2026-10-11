import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import { previewAdminEmailMessage, sendAdminEmailMessage, sendTestAdminEmailMessage } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type EmailPreview = DataOf<typeof previewAdminEmailMessage>
export type QueuedEmail = DataOf<typeof sendAdminEmailMessage>

export type ClientSendRequest = Readonly<{
  templateId: string
  revision: number
  userId: string
  expectedEmailRevision: string
}>

export type TestSendRequest = Readonly<{ templateId: string; revision: number }>

type Keyed<T> = T & Readonly<{ idempotencyKey: string }>

export const useEmailPreview = (templateId: string, userId: string): UseQueryResult<EmailPreview> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.emailPreview(templateId, userId),
    enabled: templateId !== "",
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (
        await api.request(previewAdminEmailMessage, {
          query: { templateId, ...(userId === "" ? {} : { userId }) },
        })
      ).data,
  })
}

const useRefreshAfterSend = () => {
  const queryClient = useQueryClient()
  return async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "email-preview"] })
    await queryClient.invalidateQueries({ queryKey: ["admin", "email-deliveries"] })
  }
}

export const useSendEmail = (): UseMutationResult<QueuedEmail, Error, Keyed<ClientSendRequest>> => {
  const api = useApi()
  const refresh = useRefreshAfterSend()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: Keyed<ClientSendRequest>) =>
      (await api.request(sendAdminEmailMessage, { body, idempotencyKey })).data,
    onSuccess: refresh,
  })
}

export const useSendTestEmail = (): UseMutationResult<QueuedEmail, Error, Keyed<TestSendRequest>> => {
  const api = useApi()
  const refresh = useRefreshAfterSend()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: Keyed<TestSendRequest>) =>
      (await api.request(sendTestAdminEmailMessage, { body, idempotencyKey })).data,
    onSuccess: refresh,
  })
}
