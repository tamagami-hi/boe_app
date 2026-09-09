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

import { mintIdempotencyKey } from "~/api/idempotency"
import { STALE } from "~/api/queryKeys"
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

export const useMarkMaturity = (userId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: z.input<typeof markAdminClientMatured.request.body>) =>
      (await api.request(markAdminClientMatured, { params: { userId }, body, idempotencyKey: mintIdempotencyKey() })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "investor", userId] })
    },
  })
}

type SettlementInput = Readonly<{ maturityId: string }> & (
  | Readonly<{ kind: "withdrawal"; body: z.input<typeof withdrawAdminClientMaturity.request.body> }>
  | Readonly<{ kind: "reinvestment"; body: z.input<typeof reinvestAdminClientMaturity.request.body> }>
)

export const useSettleMaturity = (userId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SettlementInput) => {
      const options = { params: { userId, maturityId: input.maturityId }, idempotencyKey: mintIdempotencyKey() }
      return input.kind === "withdrawal"
        ? (await api.request(withdrawAdminClientMaturity, { ...options, body: input.body })).data
        : (await api.request(reinvestAdminClientMaturity, { ...options, body: input.body })).data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "investor", userId] })
    },
  })
}

export const useUpdatePayout = (userId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Readonly<{ payoutId: string; body: z.input<typeof updateAdminWithdrawalPayout.request.body> }>) =>
      (await api.request(updateAdminWithdrawalPayout, {
        params: { userId, payoutId: input.payoutId }, body: input.body, idempotencyKey: mintIdempotencyKey(),
      })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "investor", userId] })
    },
  })
}
