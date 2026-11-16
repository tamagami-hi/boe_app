import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  exitAdminSipScheduleEarly,
  getAdminSipEarlyExitPreview,
  listAdminClientSipEarlyExits,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type AdminSipEarlyExits = DataOf<typeof listAdminClientSipEarlyExits>
export type AdminSipEarlyExitItem = AdminSipEarlyExits["items"][number]
export type AdminSipEarlyExitPreview = DataOf<typeof getAdminSipEarlyExitPreview>

export type ExitSipEarlyInput = Readonly<{
  scheduleId: string
  expectedVersion: number
  expectedValuePaise: string
}> &
  Readonly<{ idempotencyKey: string }>

export const useClientSipEarlyExits = (userId: string): UseQueryResult<AdminSipEarlyExits> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.clientSipEarlyExits(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listAdminClientSipEarlyExits, { params: { userId } })).data,
  })
}

export const useSipEarlyExitPreview = (userId: string, scheduleId: string): UseQueryResult<AdminSipEarlyExitPreview> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.sipEarlyExitPreview(userId, scheduleId),
    enabled: userId !== "" && scheduleId !== "",
    staleTime: 0,
    queryFn: async () => (await api.request(getAdminSipEarlyExitPreview, { params: { userId, scheduleId } })).data,
  })
}

export const useExitSipEarly = (userId: string): UseMutationResult<AdminSipEarlyExitItem, Error, ExitSipEarlyInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, ...body }: ExitSipEarlyInput) =>
      (await api.request(exitAdminSipScheduleEarly, { params: { userId, scheduleId }, body, idempotencyKey })).data.earlyExit,
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "investor", userId] }),
        queryClient.invalidateQueries({ queryKey: qk.admin.maturitiesRoot() }),
        queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() }),
      ])
    },
  })
}

export const earlyExitEntryIds = (query: UseQueryResult<AdminSipEarlyExits>): ReadonlySet<string> =>
  new Set((query.data?.items ?? []).map((item) => item.entryId))
