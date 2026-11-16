import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  acceptAdminNomineeRequest,
  declineAdminNomineeRequest,
  getAdminNomineeRequestSummary,
  listAdminNomineeRequests,
  listAdminUserNomineeRequests,
} from "~/api/generated/operations"
import type { DataOf, HttpClient } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import type { NomineeRequestState } from "~/domain/nomineeRequests"

export type NomineeRequestPage = DataOf<typeof listAdminNomineeRequests>
export type AdminNomineeRequest = NomineeRequestPage["items"][number]
export type NomineeRequestSummary = DataOf<typeof getAdminNomineeRequestSummary>
export type NomineeDecision = DataOf<typeof acceptAdminNomineeRequest>

export type NomineeDecisionInput =
  | Readonly<{ verb: "accept"; requestId: string; expectedVersion: number; expectedNomineeVersion: number; idempotencyKey: string }>
  | Readonly<{ verb: "decline"; requestId: string; expectedVersion: number; reason: string | null; idempotencyKey: string }>

const PAGE_LIMIT = 25

export const useNomineeRequestQueue = (state: NomineeRequestState | null): PagedQuery<NomineeRequestPage> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.nomineeRequests(state ?? "any"),
    staleTime: STALE.MONEY,
    limit: PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminNomineeRequests, {
        query: { limit: PAGE_LIMIT, after, ...(state === null ? {} : { state }) },
      }),
  })
}

export const useNomineeRequestSummary = (enabled: boolean): UseQueryResult<NomineeRequestSummary> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.nomineeRequestSummary(),
    enabled,
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminNomineeRequestSummary)).data,
  })
}

export const useUserNomineeRequests = (userId: string): PagedQuery<NomineeRequestPage> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.userNomineeRequests(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    limit: PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminUserNomineeRequests, { params: { userId }, query: { limit: PAGE_LIMIT, after } }),
  })
}

const decide = (api: HttpClient, input: NomineeDecisionInput): Promise<NomineeDecision> => {
  const { requestId, idempotencyKey, expectedVersion } = input
  const params = { requestId }
  if (input.verb === "accept") {
    const body = { expectedVersion, expectedNomineeVersion: input.expectedNomineeVersion }
    return api.request(acceptAdminNomineeRequest, { params, body, idempotencyKey }).then((response) => response.data)
  }
  const body = { expectedVersion, reason: input.reason }
  return api.request(declineAdminNomineeRequest, { params, body, idempotencyKey }).then((response) => response.data)
}

export const useDecideNomineeRequest = (userId: string): UseMutationResult<NomineeDecision, Error, NomineeDecisionInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NomineeDecisionInput) => decide(api, input),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.admin.user(userId) }),
        queryClient.invalidateQueries({ queryKey: qk.admin.nomineeRequestsRoot() }),
      ])
    },
  })
}
