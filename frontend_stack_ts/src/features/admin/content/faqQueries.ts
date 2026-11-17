import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { archiveAdminFaq, createAdminFaq, editAdminFaq, setAdminFaqStatus } from "~/api/generated/operations"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

type Keyed = Readonly<{ idempotencyKey: string }>

export type FaqFields = Readonly<{
  question: string
  answer: string
  category: string
  order: number
}>

export type FaqEdit = Readonly<{ faqId: string } & FaqFields>
export type FaqStatusChange = Readonly<{ faqId: string; status: "draft" | "published" | "archived" }>
export type FaqArchive = Readonly<{ faqId: string }>

export const useCreateFaq = (): UseMutationResult<void, Error, FaqFields & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: FaqFields & Keyed) => {
      await api.request(createAdminFaq, { body, idempotencyKey })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.faqs() })
    },
  })
}

export const useEditFaq = (): UseMutationResult<void, Error, FaqEdit & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ faqId, idempotencyKey, ...body }: FaqEdit & Keyed) => {
      await api.request(editAdminFaq, { params: { faqId }, body, idempotencyKey })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.faqs() })
    },
  })
}

export const useSetFaqStatus = (): UseMutationResult<void, Error, FaqStatusChange & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ faqId, status, idempotencyKey }: FaqStatusChange & Keyed) => {
      await api.request(setAdminFaqStatus, { params: { faqId }, body: { status }, idempotencyKey })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.faqs() })
    },
  })
}

export const useArchiveFaq = (): UseMutationResult<void, Error, FaqArchive & Keyed> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ faqId, idempotencyKey }: FaqArchive & Keyed) => {
      await api.request(archiveAdminFaq, { params: { faqId }, idempotencyKey })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.faqs() })
    },
  })
}
