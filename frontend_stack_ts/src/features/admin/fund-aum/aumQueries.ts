import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { z } from "zod"

import { appendAdminFundAumGrowth, initializeAdminFundAum } from "~/api/generated/operations"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import { mintIdempotencyKey } from "~/api/idempotency"

type AumInitializeInput = z.input<typeof initializeAdminFundAum.request.body>
type AumGrowthInput = z.input<typeof appendAdminFundAumGrowth.request.body>

export const useInitializeAum = (fundId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: AumInitializeInput) => {
      await api.request(initializeAdminFundAum, {
        params: { fundId },
        body,
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) }),
        queryClient.invalidateQueries({ queryKey: ["admin", "funds"] }),
        queryClient.invalidateQueries({ queryKey: qk.client.fund(fundId) }),
        queryClient.invalidateQueries({ queryKey: qk.client.funds() }),
      ])
    },
  })
}

export const useAppendAumGrowth = (fundId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: Readonly<{ body: AumGrowthInput; idempotencyKey: string }>) => {
      await api.request(appendAdminFundAumGrowth, {
        params: { fundId },
        body,
        idempotencyKey,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) }),
        queryClient.invalidateQueries({ queryKey: ["admin", "funds"] }),
        queryClient.invalidateQueries({ queryKey: qk.client.fund(fundId) }),
        queryClient.invalidateQueries({ queryKey: qk.client.funds() }),
      ])
    },
  })
}
