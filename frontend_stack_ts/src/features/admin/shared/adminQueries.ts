import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import type { z } from "zod"

import {
  acknowledgeAdminFundReceipt,
  appendAdminIndividualClientGrowth,
  archiveAdminFaq,
  cancelAdminMandate,
  closeAdminUser,
  commitAdminCollectiveClientGrowth,
  createAdminFaq,
  decideAdminApplication,
  editAdminFaq,
  getAdminAppConfig,
  getAdminApplication,
  getAdminFundReceipt,
  getAdminMandate,
  getAdminUser,
  listAdminApplications,
  listAdminAuditEvents,
  listAdminEmailDeliveries,
  listAdminFaqs,
  listAdminFundReceipts,
  listAdminFundStocks,
  listAdminMandates,
  listAdminPayments,
  listAdminRefunds,
  listAdminUserLoginEvents,
  listAdminUsers,
  previewAdminCollectiveClientGrowth,
  publishAdminAppConfig,
  reconcileAdminMandate,
  reconcileAdminRefund,
  reinstateAdminUser,
  retryAdminRefund,
  setAdminFaqStatus,
  suspendAdminUser,
} from "~/api/generated/operations"
import { mintIdempotencyKey } from "~/api/idempotency"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

const LIST_LIMIT = 25

export type AdminApplicationFilter = Readonly<{
  status?: "submitted" | "approved" | "rejected" | "withdrawn"
}>

export const useAdminApplications = (
  filter: AdminApplicationFilter,
): PagedQuery<DataOf<typeof listAdminApplications>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.applications(filter.status ?? "any"),
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminApplications, {
        query: {
          limit: LIST_LIMIT,
          after,
          ...(filter.status === undefined ? {} : { status: filter.status }),
        },
      }),
  })
}

export const useAdminApplication = (
  applicationId: string,
): UseQueryResult<DataOf<typeof getAdminApplication>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.application(applicationId),
    enabled: applicationId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () =>
      (await api.request(getAdminApplication, { params: { applicationId } })).data,
  })
}

export const useDecideApplication = (
  applicationId: string,
): UseMutationResult<void, Error, "approved" | "rejected"> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (outcome: "approved" | "rejected") => {
      await api.request(decideAdminApplication, {
        params: { applicationId },
        query: { outcome },
        body: {},
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "applications"] })
      await queryClient.invalidateQueries({ queryKey: qk.admin.application(applicationId) })
    },
  })
}

export type AdminUserFilter = Readonly<{
  status?: "invited" | "active" | "suspended" | "closed"
  q?: string
}>

export const useAdminUsers = (
  filter: AdminUserFilter,
): PagedQuery<DataOf<typeof listAdminUsers>> => {
  const api = useApi()
  const key = `${filter.status ?? "any"}:${filter.q ?? ""}`
  return usePagedQuery({
    queryKey: qk.admin.users(key),
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminUsers, {
        query: {
          limit: LIST_LIMIT,
          after,
          ...(filter.status === undefined ? {} : { status: filter.status }),
          ...(filter.q === undefined || filter.q === "" ? {} : { q: filter.q }),
        },
      }),
  })
}

export const useAdminUser = (userId: string): UseQueryResult<DataOf<typeof getAdminUser>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.user(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminUser, { params: { userId } })).data,
  })
}

export const useAdminUserLoginEvents = (
  userId: string,
): PagedQuery<DataOf<typeof listAdminUserLoginEvents>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.userLoginEvents(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminUserLoginEvents, {
        params: { userId },
        query: { limit: LIST_LIMIT, after },
      }),
  })
}

export type UserLifecycle = "suspend" | "reinstate" | "close"

const USER_LIFECYCLE = {
  suspend: suspendAdminUser,
  reinstate: reinstateAdminUser,
  close: closeAdminUser,
} as const

export const useUserLifecycle = (
  userId: string,
): UseMutationResult<
  void,
  Error,
  Readonly<{ action: UserLifecycle; reasonCode?: string; reason?: string }>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      action,
      reasonCode,
      reason,
    }: Readonly<{ action: UserLifecycle; reasonCode?: string; reason?: string }>) => {
      await api.request(USER_LIFECYCLE[action], {
        params: { userId },
        body: {
          ...(reasonCode === undefined || reasonCode === "" ? {} : { reasonCode }),
          ...(reason === undefined || reason === "" ? {} : { reason }),
        },
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.user(userId) })
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export const useAdminFundStocks = (
  fundId: string,
): UseQueryResult<DataOf<typeof listAdminFundStocks>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.fundStocks(fundId),
    enabled: fundId !== "",
    staleTime: STALE.CATALOGUE,
    queryFn: async () => (await api.request(listAdminFundStocks, { params: { fundId } })).data,
  })
}

export type ReceiptFilter = "pending" | "acknowledged"

export const useAdminReceipts = (
  state: ReceiptFilter,
): PagedQuery<DataOf<typeof listAdminFundReceipts>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.receipts(state),
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminFundReceipts, { query: { state, limit: LIST_LIMIT, after } }),
  })
}

export const useAdminReceipt = (
  orderId: string,
): UseQueryResult<DataOf<typeof getAdminFundReceipt>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.receipt(orderId),
    enabled: orderId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminFundReceipt, { params: { orderId } })).data,
  })
}

export const useAcknowledgeReceipt = (
  orderId: string,
): UseMutationResult<
  void,
  Error,
  Readonly<{ expectedVersion: number; privateNote?: string }>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      expectedVersion,
      privateNote,
    }: Readonly<{ expectedVersion: number; privateNote?: string }>) => {
      await api.request(acknowledgeAdminFundReceipt, {
        params: { orderId },
        body: {
          expectedVersion,
          ...(privateNote === undefined || privateNote === "" ? {} : { privateNote }),
        },
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.receipt(orderId) })
      await queryClient.invalidateQueries({ queryKey: ["admin", "receipts"] })
    },
  })
}

export type RefundFilter = "all" | "pending" | "provider_pending" | "refunded" | "failed"

export const useAdminRefunds = (
  state: RefundFilter,
): PagedQuery<DataOf<typeof listAdminRefunds>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.refunds(state),
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminRefunds, { query: { state, limit: LIST_LIMIT, after } }),
  })
}

export type RefundAction = "retry" | "reconcile"

const REFUND_ACTIONS = { retry: retryAdminRefund, reconcile: reconcileAdminRefund } as const

export const useRefundAction = (): UseMutationResult<
  void,
  Error,
  Readonly<{ refundId: string; action: RefundAction }>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      refundId,
      action,
    }: Readonly<{ refundId: string; action: RefundAction }>) => {
      await api.request(REFUND_ACTIONS[action], {
        params: { refundId },
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "refunds"] })
    },
  })
}

export const useAdminPayments = (): PagedQuery<DataOf<typeof listAdminPayments>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.payments("all"),
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminPayments, { query: { limit: LIST_LIMIT, after } }),
  })
}

export type MandateFilter = Readonly<{ state?: string; attention?: boolean }>

export const useAdminMandates = (
  filter: MandateFilter,
): PagedQuery<DataOf<typeof listAdminMandates>> => {
  const api = useApi()
  const key = `${filter.state ?? "any"}:${String(filter.attention ?? false)}`
  return usePagedQuery({
    queryKey: qk.admin.mandates(key),
    staleTime: STALE.MONEY,
    retry: false,
    fetchPage: async (after) =>
      api.request(listAdminMandates, {
        query: {
          limit: LIST_LIMIT,
          after,
          ...(filter.state === undefined ? {} : { state: filter.state }),
          ...(filter.attention === true ? { attention: "true" } : {}),
        },
      }),
  })
}

export const useAdminMandate = (
  mandateId: string,
): UseQueryResult<DataOf<typeof getAdminMandate>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.mandate(mandateId),
    enabled: mandateId !== "",
    staleTime: STALE.MONEY,
    retry: false,
    queryFn: async () => (await api.request(getAdminMandate, { params: { mandateId } })).data,
  })
}

export const useMandateAction = (
  mandateId: string,
): UseMutationResult<void, Error, Readonly<{ action: "reconcile" | "cancel"; reason: string }>> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      action,
      reason,
    }: Readonly<{ action: "reconcile" | "cancel"; reason: string }>) => {
      await api.request(action === "reconcile" ? reconcileAdminMandate : cancelAdminMandate, {
        params: { mandateId },
        body: { reason },
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.mandate(mandateId) })
      await queryClient.invalidateQueries({ queryKey: ["admin", "mandates"] })
    },
  })
}

export type AuditFilter = Readonly<{ entityType?: string; command?: string }>

export const useAdminAuditEvents = (
  filter: AuditFilter,
): PagedQuery<DataOf<typeof listAdminAuditEvents>> => {
  const api = useApi()
  const key = `${filter.entityType ?? ""}:${filter.command ?? ""}`
  return usePagedQuery({
    queryKey: qk.admin.auditLogs(key),
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminAuditEvents, {
        query: {
          limit: LIST_LIMIT,
          after,
          ...(filter.entityType === undefined || filter.entityType === ""
            ? {}
            : { entityType: filter.entityType }),
          ...(filter.command === undefined || filter.command === ""
            ? {}
            : { command: filter.command }),
        },
      }),
  })
}

export type EmailDeliveryFilter = Readonly<{ state?: string; templateKey?: string }>

export const useAdminEmailDeliveries = (
  filter: EmailDeliveryFilter,
): PagedQuery<DataOf<typeof listAdminEmailDeliveries>> => {
  const api = useApi()
  const key = `${filter.state ?? ""}:${filter.templateKey ?? ""}`
  return usePagedQuery({
    queryKey: qk.admin.emailDeliveries(key),
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listAdminEmailDeliveries, {
        query: {
          limit: LIST_LIMIT,
          after,
          ...(filter.state === undefined || filter.state === "" ? {} : { state: filter.state }),
          ...(filter.templateKey === undefined || filter.templateKey === ""
            ? {}
            : { templateKey: filter.templateKey }),
        },
      }),
  })
}

export const useAdminFaqs = (): PagedQuery<DataOf<typeof listAdminFaqs>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.faqs(),
    staleTime: STALE.CATALOGUE,
    fetchPage: async (after) =>
      api.request(listAdminFaqs, { query: { limit: LIST_LIMIT, after } }),
  })
}

export type FaqFields = Readonly<{
  question: string
  answer: string
  category: string
  order: number
}>

export const useCreateFaq = (): UseMutationResult<void, Error, FaqFields> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: FaqFields) => {
      await api.request(createAdminFaq, { body, idempotencyKey: mintIdempotencyKey() })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.faqs() })
    },
  })
}

export const useEditFaq = (): UseMutationResult<
  void,
  Error,
  Readonly<{ faqId: string } & FaqFields>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ faqId, ...body }: Readonly<{ faqId: string } & FaqFields>) => {
      await api.request(editAdminFaq, {
        params: { faqId },
        body,
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.faqs() })
    },
  })
}

export const useSetFaqStatus = (): UseMutationResult<
  void,
  Error,
  Readonly<{ faqId: string; status: "draft" | "published" | "archived" }>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      faqId,
      status,
    }: Readonly<{ faqId: string; status: "draft" | "published" | "archived" }>) => {
      await api.request(setAdminFaqStatus, {
        params: { faqId },
        body: { status },
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.faqs() })
    },
  })
}

export const useArchiveFaq = (): UseMutationResult<void, Error, string> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (faqId: string) => {
      await api.request(archiveAdminFaq, {
        params: { faqId },
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.faqs() })
    },
  })
}

export const useAdminAppConfig = (): UseQueryResult<DataOf<typeof getAdminAppConfig>> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.appConfig(),
    staleTime: STALE.CONFIG,
    queryFn: async () => (await api.request(getAdminAppConfig)).data,
  })
}

export type AppConfigInput = z.input<typeof publishAdminAppConfig.request.body>

export const usePublishAppConfig = (): UseMutationResult<void, Error, AppConfigInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: AppConfigInput) => {
      await api.request(publishAdminAppConfig, { body, idempotencyKey: mintIdempotencyKey() })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.appConfig() })
    },
  })
}

export type IndividualGrowthInput = z.input<typeof appendAdminIndividualClientGrowth.request.body>

export const useIndividualClientGrowth = (): UseMutationResult<
  DataOf<typeof appendAdminIndividualClientGrowth>,
  Error,
  IndividualGrowthInput
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: IndividualGrowthInput) =>
      (
        await api.request(appendAdminIndividualClientGrowth, {
          body,
          idempotencyKey: mintIdempotencyKey(),
        })
      ).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export type CollectiveGrowthPreviewInput = z.input<
  typeof previewAdminCollectiveClientGrowth.request.body
>

export const usePreviewCollectiveClientGrowth = (): UseMutationResult<
  DataOf<typeof previewAdminCollectiveClientGrowth>,
  Error,
  CollectiveGrowthPreviewInput
> => {
  const api = useApi()
  return useMutation({
    mutationFn: async (body: CollectiveGrowthPreviewInput) =>
      (await api.request(previewAdminCollectiveClientGrowth, { body })).data,
  })
}

export type CollectiveGrowthCommitInput = z.input<
  typeof commitAdminCollectiveClientGrowth.request.body
>

export const useCommitCollectiveClientGrowth = (): UseMutationResult<
  DataOf<typeof commitAdminCollectiveClientGrowth>,
  Error,
  CollectiveGrowthCommitInput
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: CollectiveGrowthCommitInput) =>
      (
        await api.request(commitAdminCollectiveClientGrowth, {
          body,
          idempotencyKey: mintIdempotencyKey(),
        })
      ).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}
