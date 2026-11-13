import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import type { z } from "zod"

import {
  cancelAdminClientMaturity,
  confirmAdminMaturityOffer,
  editAdminClientMaturityDate,
  listAdminClientMaturitySchedules,
  listAdminDueMaturities,
  listAdminMaturities,
  resolveAdminClientMaturity,
  sendAdminMaturityOptions,
  setAdminClientMaturityDate,
  withdrawAdminMaturityOffer,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type MaturityScheduleList = DataOf<typeof listAdminClientMaturitySchedules>
export type MaturityScheduleItem = MaturityScheduleList["items"][number]
export type DueMaturities = DataOf<typeof listAdminDueMaturities>
export type MaturityDashboardState = "scheduled" | "resolved" | "cancelled"
export type SavedMaturitySchedule = DataOf<typeof setAdminClientMaturityDate>["schedule"]
export type MaturityResolution = DataOf<typeof resolveAdminClientMaturity>
export type ResolveMaturityBody = z.input<typeof resolveAdminClientMaturity.request.body>
export type MaturityOfferSummary = NonNullable<MaturityScheduleItem["offer"]>
export type SendMaturityOptionsBody = z.input<typeof sendAdminMaturityOptions.request.body>
export type ConfirmMaturityOfferBody = z.input<typeof confirmAdminMaturityOffer.request.body>

type Keyed<T> = T & Readonly<{ idempotencyKey: string }>

export type SetMaturityInput = Keyed<Readonly<{ fundId: string; maturityDate: string }>>
export type EditMaturityInput = Keyed<Readonly<{ scheduleId: string; expectedVersion: number; maturityDate: string }>>
export type CancelMaturityInput = Keyed<Readonly<{ scheduleId: string; expectedVersion: number }>>
export type ResolveMaturityInput = Keyed<Readonly<{ scheduleId: string; body: ResolveMaturityBody }>>
export type SendMaturityOptionsInput = Keyed<Readonly<{ scheduleId: string; body: SendMaturityOptionsBody }>>
export type WithdrawMaturityOfferInput = Keyed<
  Readonly<{ scheduleId: string; offerId: string; expectedVersion: number; offerVersion: number }>
>
export type ConfirmMaturityOfferInput = Keyed<Readonly<{ scheduleId: string; offerId: string; body: ConfirmMaturityOfferBody }>>

const DUE_PROMPT_LIMIT = 25

export const useMaturityDashboard = (state: MaturityDashboardState): PagedQuery<DataOf<typeof listAdminMaturities>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.maturities(state),
    staleTime: STALE.MONEY,
    fetchPage: async (after) => api.request(listAdminMaturities, { query: { state, after, limit: 25 } }),
  })
}

export const useDueMaturities = (enabled: boolean): UseQueryResult<DueMaturities> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.dueMaturities(),
    enabled,
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listAdminDueMaturities, { query: { limit: DUE_PROMPT_LIMIT } })).data,
  })
}

export const useClientMaturitySchedules = (userId: string): UseQueryResult<MaturityScheduleList> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.clientMaturitySchedules(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listAdminClientMaturitySchedules, { params: { userId } })).data,
  })
}

const useRefreshMaturities = (userId: string, includeMoney: boolean): (() => Promise<void>) => {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: includeMoney ? ["admin", "investor", userId] : qk.admin.clientMaturitySchedules(userId) }),
      queryClient.invalidateQueries({ queryKey: qk.admin.maturitiesRoot() }),
      ...(includeMoney ? [queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() })] : []),
    ])
  }
}

export const useSetMaturityDate = (userId: string): UseMutationResult<SavedMaturitySchedule, Error, SetMaturityInput> => {
  const api = useApi()
  const refresh = useRefreshMaturities(userId, false)
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: SetMaturityInput) =>
      (await api.request(setAdminClientMaturityDate, { params: { userId }, body, idempotencyKey })).data.schedule,
    onSettled: refresh,
  })
}

export const useEditMaturityDate = (userId: string): UseMutationResult<SavedMaturitySchedule, Error, EditMaturityInput> => {
  const api = useApi()
  const refresh = useRefreshMaturities(userId, false)
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, ...body }: EditMaturityInput) =>
      (await api.request(editAdminClientMaturityDate, { params: { userId, scheduleId }, body, idempotencyKey })).data
        .schedule,
    onSettled: refresh,
  })
}

export const useCancelMaturity = (userId: string): UseMutationResult<SavedMaturitySchedule, Error, CancelMaturityInput> => {
  const api = useApi()
  const refresh = useRefreshMaturities(userId, false)
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, ...body }: CancelMaturityInput) =>
      (await api.request(cancelAdminClientMaturity, { params: { userId, scheduleId }, body, idempotencyKey })).data
        .schedule,
    onSettled: refresh,
  })
}

export const useResolveMaturity = (userId: string): UseMutationResult<MaturityResolution, Error, ResolveMaturityInput> => {
  const api = useApi()
  const refresh = useRefreshMaturities(userId, true)
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, body }: ResolveMaturityInput) =>
      (await api.request(resolveAdminClientMaturity, { params: { userId, scheduleId }, body, idempotencyKey })).data,
    onSettled: refresh,
  })
}

export const useSendMaturityOptions = (
  userId: string,
): UseMutationResult<SavedMaturitySchedule, Error, SendMaturityOptionsInput> => {
  const api = useApi()
  const refresh = useRefreshMaturities(userId, false)
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, body }: SendMaturityOptionsInput) =>
      (await api.request(sendAdminMaturityOptions, { params: { userId, scheduleId }, body, idempotencyKey })).data.schedule,
    onSettled: refresh,
  })
}

export const useWithdrawMaturityOffer = (
  userId: string,
): UseMutationResult<SavedMaturitySchedule, Error, WithdrawMaturityOfferInput> => {
  const api = useApi()
  const refresh = useRefreshMaturities(userId, false)
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, offerId, ...body }: WithdrawMaturityOfferInput) =>
      (await api.request(withdrawAdminMaturityOffer, { params: { userId, scheduleId, offerId }, body, idempotencyKey })).data
        .schedule,
    onSettled: refresh,
  })
}

export const useConfirmMaturityOffer = (
  userId: string,
): UseMutationResult<MaturityResolution, Error, ConfirmMaturityOfferInput> => {
  const api = useApi()
  const refresh = useRefreshMaturities(userId, true)
  return useMutation({
    mutationFn: async ({ idempotencyKey, scheduleId, offerId, body }: ConfirmMaturityOfferInput) =>
      (await api.request(confirmAdminMaturityOffer, { params: { userId, scheduleId, offerId }, body, idempotencyKey })).data,
    onSettled: refresh,
  })
}
