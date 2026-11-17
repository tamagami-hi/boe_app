import {
  listAdminClientMaturities,
  listAdminWithdrawalPayouts,
  markAdminClientMatured,
  reinvestAdminClientMaturity,
  updateAdminWithdrawalPayout,
  withdrawAdminClientMaturity,
} from "@beonedge/contracts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { z } from "zod"

import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export const useMaturityRecords = (userId: string) => {
  const api = useApi()
  return useQuery({
    queryKey: ["admin", "investor", userId, "maturities"],
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listAdminClientMaturities, { params: { userId }, query: { limit: 100 } })).data,
  })
}

export const useWithdrawalPayouts = (userId: string) => {
  const api = useApi()
  return useQuery({
    queryKey: ["admin", "investor", userId, "withdrawal-payouts"],
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listAdminWithdrawalPayouts, { params: { userId }, query: { limit: 100 } })).data,
  })
}

type Keyed<T> = T & Readonly<{ idempotencyKey: string }>

export type MarkMaturityBody = z.input<typeof markAdminClientMatured.request.body>

export const useMarkMaturity = (userId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: Keyed<MarkMaturityBody>) =>
      (await api.request(markAdminClientMatured, { params: { userId }, body, idempotencyKey })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "investor", userId] })
    },
  })
}

export type SettlementInput = Readonly<{ maturityId: string }> & (
  | Readonly<{ kind: "withdrawal"; body: z.input<typeof withdrawAdminClientMaturity.request.body> }>
  | Readonly<{ kind: "reinvestment"; body: z.input<typeof reinvestAdminClientMaturity.request.body> }>
)

export const useSettleMaturity = (userId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Keyed<SettlementInput>) => {
      const options = { params: { userId, maturityId: input.maturityId }, idempotencyKey: input.idempotencyKey }
      return input.kind === "withdrawal"
        ? (await api.request(withdrawAdminClientMaturity, { ...options, body: input.body })).data
        : (await api.request(reinvestAdminClientMaturity, { ...options, body: input.body })).data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "investor", userId] })
      await queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() })
    },
  })
}

export type PayoutUpdateInput = Readonly<{ payoutId: string; body: z.input<typeof updateAdminWithdrawalPayout.request.body> }>

export const useUpdatePayout = (userId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ payoutId, body, idempotencyKey }: Keyed<PayoutUpdateInput>) =>
      (await api.request(updateAdminWithdrawalPayout, { params: { userId, payoutId }, body, idempotencyKey })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "investor", userId] })
    },
  })
}
