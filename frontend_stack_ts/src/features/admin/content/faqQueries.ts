import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { archiveAdminFaq, createAdminFaq, editAdminFaq, setAdminFaqStatus } from "~/api/generated/operations"
import { mintIdempotencyKey } from "~/api/idempotency"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

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
