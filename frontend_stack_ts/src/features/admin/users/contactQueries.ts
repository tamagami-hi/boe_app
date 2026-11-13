import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  correctAdminClientContacts,
  getAdminUserContactHistory,
  releaseAdminUserContacts,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type ContactHistory = DataOf<typeof getAdminUserContactHistory>
export type ContactHistoryEntry = ContactHistory["entries"][number]
export type CorrectedContacts = DataOf<typeof correctAdminClientContacts>
export type ReleasedContacts = DataOf<typeof releaseAdminUserContacts>

export type ContactCorrectionInput = Readonly<{
  email?: string
  phone?: string
  expectedVersion: number
  idempotencyKey: string
}>

export type ContactReleaseInput = Readonly<{
  expectedVersion: number
  reason?: string
  idempotencyKey: string
}>

const RELEASE_REASON_CODE = "admin_contact_release"

export const useAdminUserContactHistory = (userId: string): UseQueryResult<ContactHistory> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.userContactHistory(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminUserContactHistory, { params: { userId } })).data,
  })
}

const useRefreshUser = (userId: string): (() => Promise<void>) => {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: qk.admin.user(userId) })
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
  }
}

export const useCorrectClientContacts = (
  userId: string,
): UseMutationResult<CorrectedContacts, Error, ContactCorrectionInput> => {
  const api = useApi()
  const refresh = useRefreshUser(userId)
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: ContactCorrectionInput) =>
      (await api.request(correctAdminClientContacts, { params: { userId }, body, idempotencyKey })).data,
    onSuccess: refresh,
  })
}

export const useReleaseUserContacts = (
  userId: string,
): UseMutationResult<ReleasedContacts, Error, ContactReleaseInput> => {
  const api = useApi()
  const refresh = useRefreshUser(userId)
  return useMutation({
    mutationFn: async ({ idempotencyKey, expectedVersion, reason }: ContactReleaseInput) =>
      (
        await api.request(releaseAdminUserContacts, {
          params: { userId },
          body: {
            expectedVersion,
            reasonCode: RELEASE_REASON_CODE,
            ...(reason === undefined || reason === "" ? {} : { reason }),
          },
          idempotencyKey,
        })
      ).data,
    onSuccess: refresh,
  })
}
