import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { z } from "zod"

import {
  createAdminFund,
  publishAdminFundVersion,
  transitionAdminFundLifecycle,
} from "~/api/generated/operations"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import { mintIdempotencyKey } from "~/api/idempotency"

type CreateFundInput = z.input<typeof createAdminFund.request.body>

export const useCreateAdminFund = () => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateFundInput) => {
      const result = await api.request(createAdminFund, {
        body,
        idempotencyKey: mintIdempotencyKey(),
      })
      return result.data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "funds"] })
    },
  })
}

type TermsInput = z.input<typeof publishAdminFundVersion.request.body>

export const usePublishFundVersion = (fundId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: TermsInput) => {
      await api.request(publishAdminFundVersion, {
        params: { fundId },
        body,
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) })
      await queryClient.invalidateQueries({ queryKey: ["admin", "funds"] })
    },
  })
}

export const useTransitionFundLifecycle = (fundId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Readonly<{ status: "published" | "paused" | "archived"; version: number }>) => {
      await api.request(transitionAdminFundLifecycle, {
        params: { fundId },
        body: { status: input.status },
        ifMatch: `"${String(input.version)}"`,
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) })
      await queryClient.invalidateQueries({ queryKey: ["admin", "funds"] })
    },
  })
}
