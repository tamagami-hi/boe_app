import { useQueries, useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import {
  getAdminClientPortfolioSummary,
  listAdminClientLedgerPage,
  listAdminClientValueSummaries,
  listAdminEmailDeliveries,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type ReturnSort = "return_desc" | "return_asc"

export type ClientValueSummaries = DataOf<typeof listAdminClientValueSummaries>
export type ClientValueSummary = ClientValueSummaries["items"][number]

const SUMMARY_PAGE_LIMIT = 50
const SUMMARY_CHUNK_SIZE = 100
const LEDGER_PAGE_LIMIT = 50
const EMAIL_PAGE_LIMIT = 25

export const useClientPortfolioSummary = (
  userId: string,
  enabled: boolean,
): UseQueryResult<DataOf<typeof getAdminClientPortfolioSummary>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.clientPortfolioSummary(userId),
    enabled: enabled && userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminClientPortfolioSummary, { params: { userId } })).data,
  })
}

export const useClientValueSummaries = (sort: ReturnSort): PagedQuery<ClientValueSummaries> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.clientValueSummaries(sort),
    staleTime: STALE.MONEY,
    limit: SUMMARY_PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminClientValueSummaries, { query: { sort, limit: SUMMARY_PAGE_LIMIT, after } }),
  })
}

export type SummariesByUser = Readonly<{
  byUserId: ReadonlyMap<string, ClientValueSummary>
  isPending: boolean
  error: unknown
  refetch: () => void
}>

const chunksOf = (ids: readonly string[]): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(ids.length / SUMMARY_CHUNK_SIZE) }, (_, index) =>
    ids.slice(index * SUMMARY_CHUNK_SIZE, (index + 1) * SUMMARY_CHUNK_SIZE),
  )

export const useClientValueSummariesFor = (userIds: readonly string[], enabled: boolean): SummariesByUser => {
  const api = useApi()
  return useQueries({
    queries: chunksOf(userIds).map((chunk) => ({
      queryKey: qk.admin.clientValueSummaries(`users:${chunk.join(",")}`),
      enabled,
      staleTime: STALE.MONEY,
      queryFn: async () =>
        (await api.request(listAdminClientValueSummaries, { query: { userIds: chunk.join(","), limit: chunk.length } }))
          .data,
    })),
    combine: (results) => ({
      byUserId: new Map(results.flatMap((result) => result.data?.items ?? []).map((item) => [item.userId, item])),
      isPending: results.some((result) => result.isPending),
      error: results.find((result) => result.error !== null)?.error ?? null,
      refetch: () => {
        for (const result of results) void result.refetch()
      },
    }),
  })
}

export const useClientLedgerPage = (userId: string): PagedQuery<DataOf<typeof listAdminClientLedgerPage>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.clientLedgerPage(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    limit: LEDGER_PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminClientLedgerPage, { params: { userId }, query: { limit: LEDGER_PAGE_LIMIT, after } }),
  })
}

export const useClientEmailDeliveries = (userId: string): PagedQuery<DataOf<typeof listAdminEmailDeliveries>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.emailDeliveries(`user:${userId}`),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    limit: EMAIL_PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminEmailDeliveries, { query: { userId, limit: EMAIL_PAGE_LIMIT, after } }),
  })
}
