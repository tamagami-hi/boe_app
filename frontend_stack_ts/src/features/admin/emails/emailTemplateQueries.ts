import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  archiveAdminEmailTemplate,
  createAdminEmailTemplate,
  getAdminEmailTemplate,
  listAdminEmailTemplates,
  restoreAdminEmailTemplate,
  reviseAdminEmailTemplate,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type EmailTemplate = DataOf<typeof createAdminEmailTemplate>
export type EmailTemplateList = DataOf<typeof listAdminEmailTemplates>
export type EmailTemplateDetail = DataOf<typeof getAdminEmailTemplate>

export type TemplateContent = Readonly<{ name: string; description: string; subject: string; body: string }>

export const useEmailTemplates = (includeArchived: boolean): UseQueryResult<EmailTemplateList> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.emailTemplates(includeArchived ? "all" : "active"),
    staleTime: STALE.CATALOGUE,
    queryFn: async () =>
      (await api.request(listAdminEmailTemplates, { query: { includeArchived: includeArchived ? "true" : "false" } })).data,
  })
}

export const useEmailTemplate = (templateId: string): UseQueryResult<EmailTemplateDetail> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.emailTemplate(templateId),
    enabled: templateId !== "",
    staleTime: STALE.CATALOGUE,
    queryFn: async () => (await api.request(getAdminEmailTemplate, { params: { templateId } })).data,
  })
}

const useInvalidateTemplates = () => {
  const queryClient = useQueryClient()
  return async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "email-templates"] })
    await queryClient.invalidateQueries({ queryKey: ["admin", "email-template"] })
  }
}

export const useCreateEmailTemplate = (): UseMutationResult<
  EmailTemplate,
  Error,
  TemplateContent & Readonly<{ idempotencyKey: string }>
> => {
  const api = useApi()
  const invalidate = useInvalidateTemplates()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: TemplateContent & Readonly<{ idempotencyKey: string }>) =>
      (await api.request(createAdminEmailTemplate, { body, idempotencyKey })).data,
    onSettled: invalidate,
  })
}

export const useReviseEmailTemplate = (
  templateId: string,
): UseMutationResult<EmailTemplate, Error, TemplateContent & Readonly<{ expectedVersion: number; idempotencyKey: string }>> => {
  const api = useApi()
  const invalidate = useInvalidateTemplates()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: TemplateContent & Readonly<{ expectedVersion: number; idempotencyKey: string }>) =>
      (await api.request(reviseAdminEmailTemplate, { params: { templateId }, body, idempotencyKey })).data,
    onSettled: invalidate,
  })
}

export const useSetTemplateArchived = (
  templateId: string,
): UseMutationResult<EmailTemplate, Error, Readonly<{ archived: boolean; expectedVersion: number; idempotencyKey: string }>> => {
  const api = useApi()
  const invalidate = useInvalidateTemplates()
  return useMutation({
    mutationFn: async ({ archived, expectedVersion, idempotencyKey }: Readonly<{ archived: boolean; expectedVersion: number; idempotencyKey: string }>) =>
      (
        await api.request(archived ? archiveAdminEmailTemplate : restoreAdminEmailTemplate, {
          params: { templateId },
          body: { expectedVersion },
          idempotencyKey,
        })
      ).data,
    onSettled: invalidate,
  })
}
