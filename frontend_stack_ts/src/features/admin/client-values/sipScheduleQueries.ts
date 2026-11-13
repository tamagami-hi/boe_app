import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  closeAdminSipSchedule,
  createAdminSipSchedule,
  editAdminSipSchedule,
  listAdminClientSipSchedules,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type AdminSipSchedules = DataOf<typeof listAdminClientSipSchedules>
export type AdminSipScheduleItem = AdminSipSchedules["items"][number]
export type SavedSipSchedule = DataOf<typeof createAdminSipSchedule>["schedule"]

type Keyed<T> = T & Readonly<{ idempotencyKey: string }>

export type CreateSipScheduleInput = Keyed<
  Readonly<{ fundId: string; monthlyAmountPaise: string; startMonth: string; monthCount: number }>
>

export type EditSipScheduleInput = Keyed<
  Readonly<{
    scheduleId: string
    expectedVersion: number
    monthlyAmountPaise?: string
    monthCount?: number
    state?: "active" | "closed"
  }>
>

export type CloseSipScheduleInput = Keyed<Readonly<{ scheduleId: string; expectedVersion: number }>>

export const useClientSipSchedules = (userId: string): UseQueryResult<AdminSipSchedules> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.clientSipSchedules(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listAdminClientSipSchedules, { params: { userId } })).data,
  })
}

const useRefreshSchedules = (userId: string): (() => Promise<void>) => {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: qk.admin.clientSipSchedules(userId) })
  }
}

export const useCreateSipSchedule = (
  userId: string,
): UseMutationResult<SavedSipSchedule, Error, CreateSipScheduleInput> => {
  const api = useApi()
  const refresh = useRefreshSchedules(userId)
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: CreateSipScheduleInput) =>
      (await api.request(createAdminSipSchedule, { params: { userId }, body, idempotencyKey })).data.schedule,
    onSettled: refresh,
  })
}

export const useEditSipSchedule = (
  userId: string,
): UseMutationResult<SavedSipSchedule, Error, EditSipScheduleInput> => {
  const api = useApi()
  const refresh = useRefreshSchedules(userId)
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, ...body }: EditSipScheduleInput) =>
      (await api.request(editAdminSipSchedule, { params: { userId, scheduleId }, body, idempotencyKey })).data.schedule,
    onSettled: refresh,
  })
}

export const useCloseSipSchedule = (
  userId: string,
): UseMutationResult<SavedSipSchedule, Error, CloseSipScheduleInput> => {
  const api = useApi()
  const refresh = useRefreshSchedules(userId)
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, ...body }: CloseSipScheduleInput) =>
      (await api.request(closeAdminSipSchedule, { params: { userId, scheduleId }, body, idempotencyKey })).data.schedule,
    onSettled: refresh,
  })
}
