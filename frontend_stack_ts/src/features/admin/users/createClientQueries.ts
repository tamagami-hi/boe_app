import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { createAdminClient } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { useApi } from "~/app/providers/ApiProvider"

export type CreateAdminClientInput = Readonly<{
  idempotencyKey: string
  fullName: string
  email: string
  phone: string
}>

export const useCreateAdminClient = (): UseMutationResult<
  DataOf<typeof createAdminClient>,
  Error,
  CreateAdminClientInput
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: CreateAdminClientInput) =>
      (
        await api.request(createAdminClient, {
          body,
          idempotencyKey,
        })
      ).data,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}
