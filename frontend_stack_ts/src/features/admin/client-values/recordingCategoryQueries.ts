import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  getAdminSipLinkProposal,
  linkAdminSipScheduleMonths,
  listAdminClientRecordings,
  setAdminRecordingCategory,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type AdminClientRecordings = DataOf<typeof listAdminClientRecordings>
export type AdminClientRecordingItem = AdminClientRecordings["items"][number]
export type AdminSipLinkProposal = DataOf<typeof getAdminSipLinkProposal>
export type LinkedSipMonths = DataOf<typeof linkAdminSipScheduleMonths>
export type CategorisedRecording = DataOf<typeof setAdminRecordingCategory>["recording"]

type Keyed<T> = T & Readonly<{ idempotencyKey: string }>

export type SipMonthLinksInput = Keyed<Readonly<{ scheduleId: string; links: readonly Readonly<{ month: string; entryId: string }>[] }>>

export type OneTimeInput = Keyed<Readonly<{ entryId: string }>>

const investorRoot = (userId: string) => ["admin", "investor", userId] as const

const recordingsKey = (userId: string) => [...investorRoot(userId), "recordings"] as const

const proposalKey = (userId: string, scheduleId: string) => [...investorRoot(userId), "sip-link-proposal", scheduleId] as const

export const useClientRecordings = (userId: string): UseQueryResult<AdminClientRecordings> => {
  const api = useApi()
  return useQuery({
    queryKey: recordingsKey(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listAdminClientRecordings, { params: { userId } })).data,
  })
}

export const useSipLinkProposal = (userId: string, scheduleId: string): UseQueryResult<AdminSipLinkProposal> => {
  const api = useApi()
  return useQuery({
    queryKey: proposalKey(userId, scheduleId),
    enabled: userId !== "" && scheduleId !== "",
    staleTime: 0,
    queryFn: async () => (await api.request(getAdminSipLinkProposal, { params: { userId, scheduleId } })).data,
  })
}

const useRefreshInvestor = (userId: string): (() => Promise<void>) => {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: investorRoot(userId) }),
      queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() }),
    ])
  }
}

export const useLinkSipMonths = (userId: string): UseMutationResult<LinkedSipMonths, Error, SipMonthLinksInput> => {
  const api = useApi()
  const refresh = useRefreshInvestor(userId)
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, links }: SipMonthLinksInput) =>
      (
        await api.request(linkAdminSipScheduleMonths, {
          params: { userId, scheduleId },
          body: { links: [...links] },
          idempotencyKey,
        })
      ).data,
    onSettled: refresh,
  })
}

export const useMarkRecordingOneTime = (userId: string): UseMutationResult<CategorisedRecording, Error, OneTimeInput> => {
  const api = useApi()
  const refresh = useRefreshInvestor(userId)
  return useMutation({
    mutationFn: async ({ idempotencyKey, entryId }: OneTimeInput) =>
      (
        await api.request(setAdminRecordingCategory, {
          params: { userId, entryId },
          body: { category: "one_time" },
          idempotencyKey,
        })
      ).data.recording,
    onSettled: refresh,
  })
}
