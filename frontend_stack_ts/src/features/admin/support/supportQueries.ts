import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  getAdminSupportTicket,
  listAdminSupportTickets,
  listAdminUserSupportTickets,
  respondToAdminSupportTicket,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import type { SupportRequestState } from "~/domain/status"

export type SupportInbox = DataOf<typeof listAdminSupportTickets>
export type SupportTicketSummary = SupportInbox["items"][number]
export type SupportTicketDetail = DataOf<typeof getAdminSupportTicket>
export type SupportTicketEvent = SupportTicketDetail["history"][number]

export type SupportResponseInput = Readonly<{
  status: SupportRequestState
  resolutionNote: string
  expectedVersion: number
  idempotencyKey: string
}>

const PAGE_LIMIT = 25

export const useSupportInbox = (
  status: SupportRequestState | null,
  limit: number = PAGE_LIMIT,
): PagedQuery<SupportInbox> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.supportTickets(status ?? "any"),
    staleTime: STALE.MONEY,
    limit,
    fetchPage: async (after) =>
      api.request(listAdminSupportTickets, {
        query: { limit, after, ...(status === null ? {} : { status }) },
      }),
  })
}

export const useUserSupportTickets = (userId: string): PagedQuery<DataOf<typeof listAdminUserSupportTickets>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.userSupportTickets(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminUserSupportTickets, { params: { userId }, query: { limit: PAGE_LIMIT, after } }),
  })
}

export const useSupportTicket = (ticketId: string): UseQueryResult<SupportTicketDetail> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.supportTicket(ticketId),
    enabled: ticketId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminSupportTicket, { params: { ticketId } })).data,
  })
}

export const useRespondToSupportTicket = (
  ticketId: string,
): UseMutationResult<SupportTicketDetail, Error, SupportResponseInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: SupportResponseInput) =>
      (await api.request(respondToAdminSupportTicket, { params: { ticketId }, body, idempotencyKey })).data,
    onSuccess: async (ticket) => {
      queryClient.setQueryData(qk.admin.supportTicket(ticketId), ticket)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "support-tickets"] }),
        queryClient.invalidateQueries({ queryKey: qk.admin.userSupportTickets(ticket.userId) }),
      ])
    },
  })
}
