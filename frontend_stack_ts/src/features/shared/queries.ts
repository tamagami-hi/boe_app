import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import {
  getClientEligibility,
  getClientFund,
  getClientPortfolio,
  getEmailVerificationStatus,
  listClientFunds,
  listClientNotifications,
  listClientTransactions,
  listSupportFaqs,
  markNotificationRead,
  startEmailVerification,
  verifyEmail,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import { useSession } from "~/app/providers/SessionProvider"

export const useEligibility = (): UseQueryResult<DataOf<typeof getClientEligibility>> => {
  const api = useApi()
  const { principal } = useSession()
  const userId = principal?.userId ?? ""
  return useQuery({
    queryKey: qk.client.eligibility(userId),
    enabled: userId !== "",
    staleTime: STALE.ELIGIBILITY,
    queryFn: async () => (await api.request(getClientEligibility)).data,
  })
}

export const usePortfolio = (): UseQueryResult<DataOf<typeof getClientPortfolio>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.portfolio(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getClientPortfolio)).data,
  })
}

export const useFunds = (): UseQueryResult<DataOf<typeof listClientFunds>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.funds(),
    staleTime: STALE.CATALOGUE,
    queryFn: async () => (await api.request(listClientFunds, { query: { limit: 100 } })).data,
  })
}

export const useFund = (fundId: string): UseQueryResult<DataOf<typeof getClientFund>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.fund(fundId),
    enabled: fundId !== "",
    staleTime: STALE.CATALOGUE,
    queryFn: async () => (await api.request(getClientFund, { params: { fundId } })).data,
  })
}

export const useTransactions = (): UseQueryResult<DataOf<typeof listClientTransactions>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.transactions("all"),
    staleTime: STALE.MONEY,
    queryFn: async () =>
      (await api.request(listClientTransactions, { query: { limit: 100 } })).data,
  })
}

export const useNotifications = (): UseQueryResult<DataOf<typeof listClientNotifications>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.notifications(),
    staleTime: STALE.MONEY,
    queryFn: async () =>
      (await api.request(listClientNotifications, { query: { limit: 50 } })).data,
  })
}

export const useSupportFaqs = (): UseQueryResult<DataOf<typeof listSupportFaqs>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.supportFaqs(),
    staleTime: STALE.CATALOGUE,
    queryFn: async () => (await api.request(listSupportFaqs)).data,
  })
}

export const useEmailVerificationStatus = (): UseQueryResult<
  DataOf<typeof getEmailVerificationStatus>
> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.emailVerification(),
    staleTime: STALE.ELIGIBILITY,
    queryFn: async () => (await api.request(getEmailVerificationStatus)).data,
  })
}

export const useMarkNotificationRead = () => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (notificationId: string) => {
      await api.request(markNotificationRead, {
        params: { notificationId },
        body: { read: true },
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.client.notifications() })
    },
  })
}

export const useStartEmailVerification = () => {
  const api = useApi()
  return useMutation({
    mutationFn: async () => {
      await api.request(startEmailVerification)
    },
  })
}

export const useVerifyEmail = () => {
  const api = useApi()
  const queryClient = useQueryClient()
  const { principal } = useSession()
  return useMutation({
    mutationFn: async (code: string) => {
      await api.request(verifyEmail, { body: { code } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.client.emailVerification() })
      if (principal !== null) {
        await queryClient.invalidateQueries({ queryKey: qk.client.eligibility(principal.userId) })
      }
    },
  })
}
