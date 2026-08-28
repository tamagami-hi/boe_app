import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  cancelAutoPaySip,
  cancelClientSip,
  createClientOrder,
  createClientSip,
  createSupportTicket,
  getAppConfig,
  getAutoPaySip,
  getClientEligibility,
  getClientFund,
  getClientOrder,
  getClientPayment,
  getClientPortfolio,
  getEmailVerificationStatus,
  getPublicDisclosures,
  getPublicGrievance,
  getPublicInvestorCharter,
  listClientFunds,
  listClientNotifications,
  listClientOrders,
  listClientPayments,
  listClientSips,
  listClientStatements,
  listClientTransactions,
  listSupportFaqs,
  listSupportTickets,
  markNotificationRead,
  pauseClientSip,
  payClientOrder,
  resumeClientSip,
  retryAutoPaySetup,
  startAutoPaySip,
  startEmailVerification,
  verifyEmail,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { CLIENT_MONEY_PREFIXES, STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import { useSession } from "~/app/providers/SessionProvider"

const PAYMENT_POLL_INTERVAL_MS = 4_000

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

export const useOrders = (): UseQueryResult<DataOf<typeof listClientOrders>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.orders(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listClientOrders, { query: { limit: 100 } })).data,
  })
}

export const useOrder = (orderId: string): UseQueryResult<DataOf<typeof getClientOrder>> => {
  const api = useApi()
  return useQuery({
    queryKey: [...qk.client.orders(), orderId],
    enabled: orderId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getClientOrder, { params: { orderId } })).data,
  })
}

export const usePayments = (
  status: string,
): UseQueryResult<DataOf<typeof listClientPayments>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.payments(status),
    staleTime: STALE.MONEY,
    queryFn: async () =>
      (
        await api.request(listClientPayments, {
          query: { limit: 100, ...(status === "all" ? {} : { status }) },
        })
      ).data,
  })
}

export const useStatements = (): UseQueryResult<DataOf<typeof listClientStatements>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.statements(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listClientStatements)).data,
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

export const useSupportTickets = (): UseQueryResult<DataOf<typeof listSupportTickets>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.supportTickets(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listSupportTickets, { query: { limit: 50 } })).data,
  })
}

export const useAppConfig = (): UseQueryResult<DataOf<typeof getAppConfig>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.appConfig(),
    staleTime: STALE.CONFIG,
    queryFn: async () => (await api.request(getAppConfig, { unauthenticated: true })).data,
  })
}

export type LegalDocumentKind = "disclosures" | "investor-charter" | "grievance"

const LEGAL_OPERATIONS = {
  disclosures: getPublicDisclosures,
  "investor-charter": getPublicInvestorCharter,
  grievance: getPublicGrievance,
} as const

export const useLegalDocument = (
  kind: LegalDocumentKind,
): UseQueryResult<DataOf<typeof getPublicDisclosures>> => {
  const api = useApi()
  return useQuery({
    queryKey: ["public", "legal", kind],
    staleTime: STALE.CATALOGUE,
    retry: false,
    queryFn: async () =>
      (await api.request(LEGAL_OPERATIONS[kind], { unauthenticated: true })).data,
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

export const useSipPlans = (): UseQueryResult<DataOf<typeof listClientSips>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.sips(),
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(listClientSips)).data,
  })
}

export const useAutoPayPlan = (
  sipPlanId: string,
  enabled: boolean,
): UseQueryResult<DataOf<typeof getAutoPaySip>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.autopay(sipPlanId),
    enabled: enabled && sipPlanId !== "",
    staleTime: STALE.MONEY,
    retry: false,
    queryFn: async () => (await api.request(getAutoPaySip, { params: { sipPlanId } })).data,
  })
}

export const OPEN_PAYMENT_STATUSES: readonly string[] = [
  "payment_in_progress",
  "processing",
  "refund_in_progress",
]

export const usePayment = (
  paymentId: string,
): UseQueryResult<DataOf<typeof getClientPayment>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.client.payment(paymentId),
    enabled: paymentId !== "",
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.payment.status
      if (status === undefined) return PAYMENT_POLL_INTERVAL_MS
      return OPEN_PAYMENT_STATUSES.includes(status) ? PAYMENT_POLL_INTERVAL_MS : false
    },
    queryFn: async () => (await api.request(getClientPayment, { params: { paymentId } })).data,
  })
}

export const useInvalidateMoney = (): (() => Promise<void>) => {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all(
      CLIENT_MONEY_PREFIXES.map(async (prefix) =>
        queryClient.invalidateQueries({ queryKey: prefix }),
      ),
    )
  }
}

export const useMarkNotificationRead = (): UseMutationResult<void, Error, string> => {
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

export const useStartEmailVerification = (): UseMutationResult<void, Error, void> => {
  const api = useApi()
  return useMutation({
    mutationFn: async () => {
      await api.request(startEmailVerification)
    },
  })
}

export const useVerifyEmail = (): UseMutationResult<void, Error, string> => {
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

export type CreateTicketInput = Readonly<{
  subject: string
  body: string
  category: string
}>

export const useCreateSupportTicket = (): UseMutationResult<void, Error, CreateTicketInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTicketInput) => {
      await api.request(createSupportTicket, { body: input })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.client.supportTickets() })
    },
  })
}

export type CreateOrderInput = Readonly<{
  fundId: string
  amountPaise: string
  idempotencyKey: string
}>

export const useCreateOrder = (): UseMutationResult<
  DataOf<typeof createClientOrder>,
  Error,
  CreateOrderInput
> => {
  const api = useApi()
  return useMutation({
    mutationFn: async ({ fundId, amountPaise, idempotencyKey }: CreateOrderInput) =>
      (
        await api.request(createClientOrder, {
          body: { fundId, amountPaise },
          idempotencyKey,
        })
      ).data,
  })
}

export type PayOrderInput = Readonly<{
  orderId: string
  idempotencyKey: string
}>

export const usePayOrder = (): UseMutationResult<
  DataOf<typeof payClientOrder>,
  Error,
  PayOrderInput
> => {
  const api = useApi()
  return useMutation({
    mutationFn: async ({ orderId, idempotencyKey }: PayOrderInput) =>
      (
        await api.request(payClientOrder, {
          params: { orderId },
          body: { checkoutChannel: "hosted_redirect" },
          idempotencyKey,
        })
      ).data,
  })
}

export type CreateSipInput = Readonly<{
  fundId: string
  amountPaise: string
  debitDay: number
  durationMonths?: number
}>

export const useCreateSip = (): UseMutationResult<
  DataOf<typeof createClientSip>,
  Error,
  CreateSipInput
> => {
  const api = useApi()
  const invalidateMoney = useInvalidateMoney()
  return useMutation({
    mutationFn: async (input: CreateSipInput) =>
      (await api.request(createClientSip, { body: input })).data,
    onSuccess: invalidateMoney,
  })
}

export type StartAutoPayInput = Readonly<{
  fundId: string
  amountPaise: string
  debitDay: number
  durationMonths: number
  idempotencyKey: string
}>

export const useStartAutoPay = (): UseMutationResult<
  DataOf<typeof startAutoPaySip>,
  Error,
  StartAutoPayInput
> => {
  const api = useApi()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: StartAutoPayInput) =>
      (await api.request(startAutoPaySip, { body, idempotencyKey })).data,
  })
}

export type SipTransition = "pause" | "resume" | "cancel"

const SIP_TRANSITIONS = {
  pause: pauseClientSip,
  resume: resumeClientSip,
  cancel: cancelClientSip,
} as const

export const useSipTransition = (): UseMutationResult<
  void,
  Error,
  Readonly<{ sipPlanId: string; transition: SipTransition }>
> => {
  const api = useApi()
  const invalidateMoney = useInvalidateMoney()
  return useMutation({
    mutationFn: async ({
      sipPlanId,
      transition,
    }: Readonly<{ sipPlanId: string; transition: SipTransition }>) => {
      await api.request(SIP_TRANSITIONS[transition], { params: { sipPlanId } })
    },
    onSuccess: invalidateMoney,
  })
}

export const useCancelAutoPay = (): UseMutationResult<
  DataOf<typeof cancelAutoPaySip>,
  Error,
  Readonly<{ sipPlanId: string; idempotencyKey: string }>
> => {
  const api = useApi()
  const invalidateMoney = useInvalidateMoney()
  return useMutation({
    mutationFn: async ({
      sipPlanId,
      idempotencyKey,
    }: Readonly<{ sipPlanId: string; idempotencyKey: string }>) =>
      (await api.request(cancelAutoPaySip, { params: { sipPlanId }, idempotencyKey })).data,
    onSuccess: invalidateMoney,
  })
}

export const useRetryAutoPaySetup = (): UseMutationResult<
  DataOf<typeof retryAutoPaySetup>,
  Error,
  Readonly<{ sipPlanId: string; idempotencyKey: string }>
> => {
  const api = useApi()
  return useMutation({
    mutationFn: async ({
      sipPlanId,
      idempotencyKey,
    }: Readonly<{ sipPlanId: string; idempotencyKey: string }>) =>
      (await api.request(retryAutoPaySetup, { params: { sipPlanId }, idempotencyKey })).data,
  })
}
