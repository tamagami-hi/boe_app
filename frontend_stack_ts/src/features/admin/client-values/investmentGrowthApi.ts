import { AdminInvestmentRef } from "@beonedge/contracts"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import type { QueryClient, UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import type { z } from "zod"

import {
  appendAdminIndividualInvestmentGrowth,
  commitAdminInvestmentGrowth,
  getAdminClientInvestments,
  previewAdminInvestmentGrowth,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import { asRecord, parseWith } from "~/features/admin/shared/heldWriteStore"

export type InvestmentRef = AdminInvestmentRef

export const refKey = (ref: InvestmentRef): string =>
  ref.kind === "sip" ? `sip:${ref.scheduleId}` : `one_time:${ref.allocationId}`

export type InvestmentGrowthPreviewBody = z.input<typeof previewAdminInvestmentGrowth.request.body>
export type InvestmentGrowthCommitBody = z.input<typeof commitAdminInvestmentGrowth.request.body>
export type IndividualInvestmentGrowthBody = z.input<typeof appendAdminIndividualInvestmentGrowth.request.body>
export type InvestmentGainItem = NonNullable<InvestmentGrowthPreviewBody["items"]>[number]

export type InvestmentGrowthPreviewData = DataOf<typeof previewAdminInvestmentGrowth>
export type InvestmentGrowthCommitData = DataOf<typeof commitAdminInvestmentGrowth>
export type IndividualInvestmentGrowthData = DataOf<typeof appendAdminIndividualInvestmentGrowth>
export type InvestmentGrowthEntry = InvestmentGrowthPreviewData["entries"][number]
export type InvestmentPart = InvestmentGrowthEntry["parts"][number]

export type AdminClientInvestmentsData = DataOf<typeof getAdminClientInvestments>
export type AdminClientInvestmentFund = AdminClientInvestmentsData["funds"][number]
export type AdminClientInvestment = AdminClientInvestmentFund["investments"][number]

export type InvestmentGrowthSkip = Readonly<{ userId: string; ref: InvestmentRef | null; reason: string }>

type WireSkip = Readonly<{ userId: string; reason: string; ref?: unknown }>

export const skipsOf = (skipped: readonly WireSkip[]): InvestmentGrowthSkip[] =>
  skipped.map((skip) => {
    const ref = AdminInvestmentRef.safeParse(skip.ref)
    return { userId: skip.userId, ref: ref.success ? ref.data : null, reason: skip.reason }
  })

export const isTargetable = (item: AdminClientInvestment): boolean => !item.reversed && BigInt(item.amountPaise) > 0n

export const mustCategoriseFirst = (fund: AdminClientInvestmentFund): boolean =>
  fund.status === "preparing" && fund.investments.length + fund.uncategorised.length > 1

const clientInvestmentsKey = (userId: string): readonly string[] => ["admin", "investor", userId, "investments"]

export const useClientInvestments = (userId: string): UseQueryResult<AdminClientInvestmentsData> => {
  const api = useApi()
  return useQuery({
    queryKey: clientInvestmentsKey(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async ({ signal }) => (await api.request(getAdminClientInvestments, { params: { userId }, signal })).data,
  })
}

export type ClientInvestmentsRead = Readonly<{
  byUserId: ReadonlyMap<string, AdminClientInvestmentsData>
  pending: boolean
  failed: boolean
}>

export const useClientInvestmentsMany = (userIds: readonly string[]): ClientInvestmentsRead => {
  const api = useApi()
  return useQueries({
    queries: userIds.map((userId) => ({
      queryKey: clientInvestmentsKey(userId),
      staleTime: STALE.MONEY,
      queryFn: async ({ signal }: Readonly<{ signal: AbortSignal }>) =>
        (await api.request(getAdminClientInvestments, { params: { userId }, signal })).data,
    })),
    combine: (results) => ({
      byUserId: new Map(
        results.flatMap((result, index) => {
          const userId = userIds[index]
          return result.data === undefined || userId === undefined ? [] : [[userId, result.data] as const]
        }),
      ),
      pending: results.some((result) => result.data === undefined && result.error == null),
      failed: results.some((result) => result.data === undefined && result.error != null),
    }),
  })
}

export const useRefreshClientInvestments = (): (() => Promise<void>) => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ["admin", "investor"] })
}

const refreshAfterGrowth = async (queryClient: QueryClient, fundId: string, userId?: string): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: userId === undefined ? ["admin", "investor"] : ["admin", "investor", userId],
    }),
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
    queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() }),
    queryClient.invalidateQueries({ queryKey: qk.admin.fundClientPositions(fundId) }),
  ])
}

export const usePreviewInvestmentGrowth = (): UseMutationResult<
  InvestmentGrowthPreviewData,
  Error,
  InvestmentGrowthPreviewBody
> => {
  const api = useApi()
  return useMutation({
    mutationFn: async (body: InvestmentGrowthPreviewBody) =>
      (await api.request(previewAdminInvestmentGrowth, { body })).data,
  })
}

export type InvestmentGrowthHold = Readonly<{ body: InvestmentGrowthCommitBody }>

type Keyed<T> = T & Readonly<{ idempotencyKey: string }>

export const useCommitInvestmentGrowth = (): UseMutationResult<
  InvestmentGrowthCommitData,
  Error,
  Keyed<InvestmentGrowthHold>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: Keyed<InvestmentGrowthHold>) =>
      (await api.request(commitAdminInvestmentGrowth, { body, idempotencyKey })).data,
    onSettled: async (_data, _error, variables) => {
      await refreshAfterGrowth(queryClient, variables.body.fundId)
    },
  })
}

export type IndividualInvestmentGrowthHold = Readonly<{ body: IndividualInvestmentGrowthBody }>

export const useIndividualInvestmentGrowth = (): UseMutationResult<
  IndividualInvestmentGrowthData,
  Error,
  Keyed<IndividualInvestmentGrowthHold>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: Keyed<IndividualInvestmentGrowthHold>) =>
      (await api.request(appendAdminIndividualInvestmentGrowth, { body, idempotencyKey })).data,
    onSettled: async (_data, _error, variables) => {
      await refreshAfterGrowth(queryClient, variables.body.fundId, variables.body.userId)
    },
  })
}

const parseCommitBody = parseWith<InvestmentGrowthCommitBody>(commitAdminInvestmentGrowth.request.body)

export const parseInvestmentGrowthCommit = (value: unknown): InvestmentGrowthHold | null => {
  const body = parseCommitBody(asRecord(value)?.body)
  return body === null ? null : { body }
}

const parseIndividualBody = parseWith<IndividualInvestmentGrowthBody>(appendAdminIndividualInvestmentGrowth.request.body)

export const parseIndividualInvestmentGrowth = (value: unknown): IndividualInvestmentGrowthHold | null => {
  const body = parseIndividualBody(asRecord(value)?.body)
  return body === null ? null : { body }
}
