import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { QueryClient, UseMutationResult } from "@tanstack/react-query"
import type { z } from "zod"

import { addAdminFundStock, editAdminFundStock, exitAdminFundStock } from "~/api/generated/operations"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

type Keyed = Readonly<{ idempotencyKey: string }>

export type StockBody = z.input<typeof addAdminFundStock.request.body>
export type StockWriteInput = Readonly<{ stockId: string | null; stock: StockBody }>
export type StockExitInput = Readonly<{ stockId: string; stockName: string }>

const refreshFund = async (queryClient: QueryClient, fundId: string): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) }),
    queryClient.invalidateQueries({ queryKey: ["admin", "funds"] }),
    queryClient.invalidateQueries({ queryKey: qk.client.fund(fundId) }),
  ])
}

export const useStockWrite = (fundId: string): UseMutationResult<void, Error, StockWriteInput & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ stockId, stock, idempotencyKey }: StockWriteInput & Keyed) => {
      if (stockId === null) {
        await api.request(addAdminFundStock, { params: { fundId }, body: stock, idempotencyKey })
        return
      }
      await api.request(editAdminFundStock, { params: { fundId, stockId }, body: stock, idempotencyKey })
    },
    onSuccess: async () => {
      await refreshFund(queryClient, fundId)
    },
  })
}

export const useStockExit = (fundId: string): UseMutationResult<void, Error, StockExitInput & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ stockId, idempotencyKey }: StockExitInput & Keyed) => {
      await api.request(exitAdminFundStock, { params: { fundId, stockId }, idempotencyKey })
    },
    onSuccess: async () => {
      await refreshFund(queryClient, fundId)
    },
  })
}
