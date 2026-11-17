import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"
import type { z } from "zod"

import {
  createAdminFund,
  publishAdminFundVersion,
  transitionAdminFundLifecycle,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

type Keyed = Readonly<{ idempotencyKey: string }>

export type CreateFundInput = z.input<typeof createAdminFund.request.body>
export type CreatedFund = DataOf<typeof createAdminFund>

export const useCreateAdminFund = (): UseMutationResult<CreatedFund, Error, CreateFundInput & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: CreateFundInput & Keyed) =>
      (await api.request(createAdminFund, { body, idempotencyKey })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "funds"] })
    },
  })
}

export type TermsInput = z.input<typeof publishAdminFundVersion.request.body>

export const usePublishFundVersion = (fundId: string): UseMutationResult<void, Error, TermsInput & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: TermsInput & Keyed) => {
      await api.request(publishAdminFundVersion, { params: { fundId }, body, idempotencyKey })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) })
      await queryClient.invalidateQueries({ queryKey: ["admin", "funds"] })
    },
  })
}

export type LifecycleStatus = "published" | "paused" | "archived"
export type LifecycleInput = Readonly<{ status: LifecycleStatus; version: number }>

export const useTransitionFundLifecycle = (fundId: string): UseMutationResult<void, Error, LifecycleInput & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ status, version, idempotencyKey }: LifecycleInput & Keyed) => {
      await api.request(transitionAdminFundLifecycle, {
        params: { fundId },
        body: { status },
        ifMatch: `"${String(version)}"`,
        idempotencyKey,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) })
      await queryClient.invalidateQueries({ queryKey: ["admin", "funds"] })
    },
  })
}
