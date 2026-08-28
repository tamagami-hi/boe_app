import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import type { z } from "zod"

import {
  appendAdminFundAumGrowth,
  createAdminFund,
  getAdminFund,
  getAdminFundAumHistory,
  initializeAdminFundAum,
  listAdminFunds,
  publishAdminFundVersion,
  transitionAdminFundLifecycle,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import { mintIdempotencyKey } from "~/api/idempotency"

export type AdminFundListFilter = Readonly<{
  state?: "draft" | "published" | "paused" | "archived"
  search?: string
}>

export const useAdminFunds = (
  filter: AdminFundListFilter,
): UseQueryResult<DataOf<typeof listAdminFunds>> => {
  const api = useApi()
  const key = `${filter.state ?? "any"}:${filter.search ?? ""}`
  return useQuery({
    queryKey: qk.admin.funds(key),
    staleTime: STALE.CATALOGUE,
    queryFn: async () =>
      (
        await api.request(listAdminFunds, {
          query: {
            limit: 100,
            ...(filter.state === undefined ? {} : { state: filter.state }),
            ...(filter.search === undefined || filter.search === ""
              ? {}
              : { search: filter.search }),
          },
        })
      ).data,
  })
}

export const useAdminFund = (fundId: string): UseQueryResult<DataOf<typeof getAdminFund>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.fund(fundId),
    enabled: fundId !== "",
    staleTime: STALE.CATALOGUE,
    queryFn: async () => (await api.request(getAdminFund, { params: { fundId } })).data,
  })
}

export const useAdminAumHistory = (
  fundId: string,
): UseQueryResult<DataOf<typeof getAdminFundAumHistory>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.fundAumHistory(fundId, "all"),
    enabled: fundId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () =>
      (await api.request(getAdminFundAumHistory, { params: { fundId }, query: { limit: 100 } }))
        .data,
  })
}

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
      await queryClient.invalidateQueries({ queryKey: qk.admin.fundAumHistory(fundId, "all") })
      await queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) })
    },
  })
}

export const useAppendAumGrowth = (fundId: string) => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: AumGrowthInput) => {
      await api.request(appendAdminFundAumGrowth, {
        params: { fundId },
        body,
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.fundAumHistory(fundId, "all") })
      await queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) })
    },
  })
}
